DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  age INTEGER NOT NULL,
  level TEXT NOT NULL
);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  hours INTEGER NOT NULL
);

CREATE TABLE enrollments (
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  progress INTEGER NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

INSERT INTO students (id, name, city, age, level) VALUES
  (1, 'Алина', 'Казань', 20, 'junior'),
  (2, 'Марат', 'Набережные Челны', 22, 'middle'),
  (3, 'Илья', 'Казань', 19, 'junior'),
  (4, 'София', 'Иннополис', 23, 'senior'),
  (5, 'Руслан', 'Казань', 21, 'middle');

INSERT INTO courses (id, title, difficulty, hours) VALUES
  (1, 'SQL Start', 'easy', 8),
  (2, 'Analytics SQL', 'medium', 14),
  (3, 'PostgreSQL Indexes', 'hard', 10);

INSERT INTO enrollments (student_id, course_id, progress, score) VALUES
  (1, 1, 90, 88),
  (2, 2, 64, 75),
  (3, 1, 45, 61),
  (4, 3, 80, 92),
  (5, 2, 72, 81);

