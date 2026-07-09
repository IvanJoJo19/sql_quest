const API_BASE = window.location.protocol.startsWith("http")
  ? ""
  : "http://127.0.0.1:8000";

const tables = {
  students: ["id", "name", "city", "age", "level"],
  courses: ["id", "title", "difficulty", "hours"],
  enrollments: ["student_id", "course_id", "progress", "score"]
};

const tasks = [
  {
    id: "select-students",
    title: "Выбрать студентов",
    topic: "SELECT",
    description: "Начнем с базового запроса. Нужно получить имена и города всех студентов из таблицы students.",
    goal: "Вывести столбцы name и city из таблицы students.",
    starter: "SELECT name, city\nFROM students;",
    expectedSql: "SELECT name, city FROM students"
  },
  {
    id: "where-kazan",
    title: "Фильтр по городу",
    topic: "WHERE",
    description: "Теперь нужно отфильтровать данные и оставить только студентов из Казани.",
    goal: "Вывести name, age и city для студентов, у которых city = 'Казань'.",
    starter: "SELECT name, age, city\nFROM students\nWHERE city = 'Казань';",
    expectedSql: "SELECT name, age, city FROM students WHERE city = 'Казань'"
  },
  {
    id: "order-score",
    title: "Сортировка оценок",
    topic: "ORDER BY",
    description: "Аналитик хочет увидеть лучшие результаты сверху. Отсортируй записи по оценке.",
    goal: "Вывести student_id и score из enrollments, отсортировав score по убыванию.",
    starter: "SELECT student_id, score\nFROM enrollments\nORDER BY score DESC;",
    expectedSql: "SELECT student_id, score FROM enrollments ORDER BY score DESC"
  },
  {
    id: "courses-medium",
    title: "Курсы средней сложности",
    topic: "WHERE",
    description: "Нужно найти курсы, которые подходят пользователям после базового уровня.",
    goal: "Вывести title и hours из courses, где difficulty = 'medium'.",
    starter: "SELECT title, hours\nFROM courses\nWHERE difficulty = 'medium';",
    expectedSql: "SELECT title, hours FROM courses WHERE difficulty = 'medium'"
  },
  {
    id: "join-progress",
    title: "Студенты и прогресс",
    topic: "JOIN",
    description: "Теперь связываем две таблицы. Нужно увидеть имя студента и его прогресс по курсу.",
    goal: "Вывести name и progress, соединив students и enrollments по id студента.",
    starter: "SELECT name, progress\nFROM students\nJOIN enrollments ON students.id = enrollments.student_id;",
    expectedSql: "SELECT name, progress FROM students JOIN enrollments ON students.id = enrollments.student_id"
  },
  {
    id: "group-city",
    title: "Сколько студентов в городах",
    topic: "GROUP BY",
    description: "Финальная задача MVP: посчитать количество студентов в каждом городе.",
    goal: "Вывести city и count из students, сгруппировав строки по city.",
    starter: "SELECT city, COUNT(*) AS count\nFROM students\nGROUP BY city;",
    expectedSql: "SELECT city, COUNT(*) AS count FROM students GROUP BY city"
  }
];

const state = {
  currentTaskId: tasks[0].id,
  solved: new Set(JSON.parse(localStorage.getItem("sqlQuestSolved") || "[]")),
  expectedResults: new Map()
};

const lessonList = document.querySelector("#lessonList");
const taskTitle = document.querySelector("#taskTitle");
const taskDescription = document.querySelector("#taskDescription");
const taskGoal = document.querySelector("#taskGoal");
const schemaView = document.querySelector("#schemaView");
const sqlEditor = document.querySelector("#sqlEditor");
const resultTable = document.querySelector("#resultTable");
const feedback = document.querySelector("#feedback");
const progressValue = document.querySelector("#progressValue");
const progressText = document.querySelector("#progressText");
const runButton = document.querySelector("#runButton");
const hintButton = document.querySelector("#hintButton");
const resetButton = document.querySelector("#resetButton");

runButton.addEventListener("click", runQuery);
hintButton.addEventListener("click", showHint);
resetButton.addEventListener("click", resetCurrentTask);

renderLessons();
renderSchema();
selectTask(tasks[0].id);
checkBackend();

function renderLessons() {
  lessonList.innerHTML = "";

  tasks.forEach((task) => {
    const button = document.createElement("button");
    button.className = "lesson-button";
    button.type = "button";
    button.dataset.taskId = task.id;
    button.innerHTML = `<strong>${task.title}</strong><span>${task.topic}</span>`;
    button.classList.toggle("active", task.id === state.currentTaskId);
    button.classList.toggle("done", state.solved.has(task.id));
    button.addEventListener("click", () => selectTask(task.id));
    lessonList.appendChild(button);
  });

  updateProgress();
}

function renderSchema() {
  schemaView.innerHTML = Object.entries(tables)
    .map(([tableName, columns]) => {
      const columnList = columns.map((column) => `<code>${column}</code>`).join("");
      return `<div class="schema-table"><strong>${tableName}</strong>${columnList}</div>`;
    })
    .join("");
}

function selectTask(taskId) {
  state.currentTaskId = taskId;
  const task = getCurrentTask();
  taskTitle.textContent = task.title;
  taskDescription.textContent = task.description;
  taskGoal.textContent = task.goal;
  sqlEditor.value = task.starter;
  resultTable.innerHTML = "";
  setFeedback("Напиши запрос и нажми «Запустить». Backend выполнит SQL в PostgreSQL.", "");

  document.querySelectorAll(".lesson-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.taskId === taskId);
    button.classList.toggle("done", state.solved.has(button.dataset.taskId));
  });
}

async function checkBackend() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();

    if (data.ok) {
      setFeedback("Backend подключен: SQL-запросы выполняются в PostgreSQL.", "success");
    }
  } catch {
    setFeedback("Backend не запущен. Запусти start_backend.bat или python backend.py.", "hint");
  }
}

async function runQuery() {
  runButton.disabled = true;

  try {
    const actual = await executeSql(sqlEditor.value);
    renderResult(actual);

    const expected = await getExpectedResult(getCurrentTask());

    if (isExpectedResult(actual, expected)) {
      state.solved.add(state.currentTaskId);
      localStorage.setItem("sqlQuestSolved", JSON.stringify([...state.solved]));
      setFeedback("Задание решено. PostgreSQL вернул ожидаемый результат.", "success");
      updateProgress();
      renderLessons();
    } else {
      setFeedback("Запрос выполнился, но результат пока не совпадает с заданием.", "error");
    }
  } catch (error) {
    resultTable.innerHTML = "";
    setFeedback(error.message, "error");
  } finally {
    runButton.disabled = false;
  }
}

async function executeSql(sql) {
  const response = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Backend вернул ошибку.");
  }

  return data;
}

async function getExpectedResult(task) {
  if (!state.expectedResults.has(task.id)) {
    state.expectedResults.set(task.id, await executeSql(task.expectedSql));
  }

  return state.expectedResults.get(task.id);
}

function renderResult(result) {
  const head = result.columns.map((column) => `<th>${column}</th>`).join("");
  const body = result.rows
    .map((row) => `<tr>${result.columns.map((column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`)
    .join("");

  resultTable.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function isExpectedResult(actual, expected) {
  return JSON.stringify(actual.columns) === JSON.stringify(expected.columns)
    && JSON.stringify(actual.rows) === JSON.stringify(expected.rows);
}

async function showHint() {
  hintButton.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/api/hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: getCurrentTask(),
        sql: sqlEditor.value
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Не удалось получить подсказку.");
    }

    setFeedback(`ИИ-помощник: ${data.hint}`, "hint");
  } catch (error) {
    setFeedback(`ИИ-помощник недоступен: ${error.message}`, "error");
  } finally {
    hintButton.disabled = false;
  }
}

function resetCurrentTask() {
  selectTask(state.currentTaskId);
}

function updateProgress() {
  const percent = Math.round((state.solved.size / tasks.length) * 100);
  progressValue.textContent = `${percent}%`;
  progressText.textContent = `Решено ${state.solved.size} из ${tasks.length} заданий`;

  document.querySelectorAll(".lesson-button").forEach((button) => {
    button.classList.toggle("done", state.solved.has(button.dataset.taskId));
  });
}

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
}

function getCurrentTask() {
  return tasks.find((task) => task.id === state.currentTaskId);
}
