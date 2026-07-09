import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_env_file():
    env_path = ROOT / ".env"

    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

DB_NAME = os.getenv("SQL_QUEST_DB", "sql_quest")
HOST = os.getenv("SQL_QUEST_HOST", "127.0.0.1")
PORT = int(os.getenv("SQL_QUEST_PORT", "8000"))
PGPORT = os.getenv("PGPORT", "55432")

POSTGRES_HOME = Path(os.getenv("POSTGRES_HOME", Path.home() / "scoop" / "apps" / "postgresql" / "current"))
POSTGRES_BIN = POSTGRES_HOME / "bin"
POSTGRES_DATA = POSTGRES_HOME / "data"

PSQL = POSTGRES_BIN / "psql.exe"
PG_CTL = POSTGRES_BIN / "pg_ctl.exe"
CREATEDB = POSTGRES_BIN / "createdb.exe"

LLM_API_URL = os.getenv("LLM_API_URL", "https://api.llm7.io/v1/chat/completions")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

BLOCKED_SQL = re.compile(
    r"\b(drop|delete|update|insert|alter|truncate|create|grant|revoke|copy|call|do|execute|vacuum|analyze|pg_sleep)\b",
    re.IGNORECASE,
)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def pg_env():
    env = os.environ.copy()
    env["PGCLIENTENCODING"] = "UTF8"
    env["PGDATABASE"] = DB_NAME
    env["PGUSER"] = os.getenv("PGUSER", "postgres")
    env["PGHOST"] = os.getenv("PGHOST", "127.0.0.1")
    env["PGPORT"] = PGPORT
    return env


def run_process(args, input_text=None, check=True, timeout=20):
    completed = subprocess.run(
        [str(arg) for arg in args],
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=pg_env(),
        timeout=timeout,
    )

    if check and completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "PostgreSQL command failed"
        raise RuntimeError(detail)

    return completed


def can_connect_to_postgres():
    completed = run_process([PSQL, "-X", "-d", "postgres", "-tAc", "SELECT 1"], check=False, timeout=5)
    return completed.returncode == 0 and completed.stdout.strip() == "1"


def ensure_postgres():
    print("Checking PostgreSQL...", flush=True)

    if not can_connect_to_postgres():
        print(f"Starting PostgreSQL on port {PGPORT}...", flush=True)
        run_process([PG_CTL, "-D", POSTGRES_DATA, "-l", ROOT / "postgres.log", "-o", f"-p {PGPORT}", "start"], check=False, timeout=45)

        for _ in range(20):
            if can_connect_to_postgres():
                break

            time.sleep(1)
        else:
            raise RuntimeError("PostgreSQL не отвечает на 127.0.0.1:55432. Проверь postgres.log.")

    print("Checking database...", flush=True)
    exists_sql = f"SELECT 1 FROM pg_database WHERE datname = '{DB_NAME}';"
    exists = run_process([PSQL, "-X", "-d", "postgres", "-tAc", exists_sql]).stdout.strip()

    if exists != "1":
        print(f"Creating database {DB_NAME}...", flush=True)
        run_process([CREATEDB, DB_NAME])

    print("Loading seed data...", flush=True)
    seed_path = ROOT / "data" / "seed.sql"
    run_process([PSQL, "-X", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-f", seed_path])
    print("PostgreSQL is ready.", flush=True)


def normalize_sql(sql):
    return sql.strip().rstrip(";").strip()


def ensure_safe_select(sql):
    cleaned = normalize_sql(sql)

    if not cleaned:
        raise ApiError(400, "SQL-запрос пустой.")

    if ";" in cleaned or "--" in cleaned or "/*" in cleaned or "*/" in cleaned:
        raise ApiError(400, "В MVP разрешен только один SELECT-запрос без комментариев.")

    if not re.match(r"^select\b", cleaned, re.IGNORECASE):
        raise ApiError(400, "В песочнице разрешены только SELECT-запросы.")

    if BLOCKED_SQL.search(cleaned):
        raise ApiError(400, "Запрос содержит запрещенную SQL-команду.")

    if not re.search(r"\blimit\b", cleaned, re.IGNORECASE):
        cleaned = f"{cleaned} LIMIT 100"

    return cleaned


def execute_select(sql):
    safe_sql = ensure_safe_select(sql)
    copy_sql = f"COPY ({safe_sql}) TO STDOUT WITH CSV HEADER"
    completed = run_process([PSQL, "-X", "-d", DB_NAME, "-c", copy_sql], check=False)

    if completed.returncode != 0:
        raise ApiError(400, completed.stderr.strip() or "PostgreSQL не смог выполнить запрос.")

    reader = csv.DictReader(completed.stdout.splitlines())
    columns = reader.fieldnames or []
    rows = list(reader)

    return {"columns": columns, "rows": rows, "source": "postgresql"}


def mock_hint(task, sql):
    topic = task.get("topic", "SQL")
    goal = task.get("goal", "решить задачу")
    sql_lower = sql.lower()

    if not sql_lower.strip().startswith("select"):
        return "Начни запрос с SELECT. В этой песочнице разрешены только безопасные запросы на чтение."

    if topic == "WHERE" and "where" not in sql_lower:
        return "В этой задаче нужен фильтр WHERE. Посмотри, по какой колонке нужно ограничить строки."

    if topic == "ORDER BY" and "order by" not in sql_lower:
        return "Здесь нужно отсортировать результат через ORDER BY. Для убывания добавь DESC."

    if topic == "JOIN" and "join" not in sql_lower:
        return "Тут нужно соединить две таблицы через JOIN и указать условие ON."

    if topic == "GROUP BY" and "group by" not in sql_lower:
        return "Для подсчета по группам используй COUNT(*) вместе с GROUP BY."

    return f"Проверь, что запрос точно выполняет цель: {goal}"


def llm_hint(task, sql):
    if not LLM_API_KEY:
        return mock_hint(task, sql)

    prompt = (
        "Ты помощник в SQL-тренажере. Дай короткую подсказку на русском языке. "
        "Не выдавай готовый полный SQL-запрос, только направление.\n\n"
        f"Тема: {task.get('topic')}\n"
        f"Задание: {task.get('goal')}\n"
        f"Запрос пользователя:\n{sql}"
    )
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "Ты объясняешь SQL новичкам кратко и дружелюбно."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {LLM_API_KEY}"}
    request = urllib.request.Request(
        LLM_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, IndexError, json.JSONDecodeError) as error:
        return f"{mock_hint(task, sql)} LLM API сейчас недоступен: {error}"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json({"ok": True, "database": DB_NAME, "llm": "api" if LLM_API_KEY else "mock"})
            return

        super().do_GET()

    def do_POST(self):
        try:
            payload = self.read_json()

            if self.path == "/api/query":
                self.send_json(execute_select(payload.get("sql", "")))
                return

            if self.path == "/api/hint":
                self.send_json({"hint": llm_hint(payload.get("task", {}), payload.get("sql", ""))})
                return

            raise ApiError(404, "Endpoint не найден.")
        except ApiError as error:
            self.send_json({"error": error.message}, status=error.status)
        except Exception as error:
            self.send_json({"error": str(error)}, status=500)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    try:
        ensure_postgres()
    except Exception as error:
        print(f"Не удалось подготовить PostgreSQL: {error}", file=sys.stderr)
        sys.exit(1)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"SQL Quest backend: http://{HOST}:{PORT}")
    print(f"PostgreSQL database: {DB_NAME} on port {PGPORT}")
    print("LLM mode:", "api" if LLM_API_KEY else "mock")
    server.serve_forever()


if __name__ == "__main__":
    main()
