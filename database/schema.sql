CREATE DATABASE IF NOT EXISTS harbour;
USE harbour;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('customer','employee','manager','admin') NOT NULL,
  email VARCHAR(100), phone VARCHAR(20), address VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_no CHAR(12) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('active','frozen') DEFAULT 'active',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  txn_id VARCHAR(24) UNIQUE NOT NULL,
  from_account CHAR(12) NOT NULL, to_account CHAR(12) NOT NULL,
  amount DECIMAL(14,2) NOT NULL, note VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE loans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL, amount DECIMAL(14,2) NOT NULL,
  purpose VARCHAR(150), tenure_months INT NOT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  decided_by INT NULL, decided_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL, message VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT, action VARCHAR(60) NOT NULL, details VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
