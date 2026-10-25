# Harbour Bank (React + Node + MySQL)

1. Create the database:   mysql -u root -p < database/schema.sql
2. Server:  cd server && cp .env.example .env  (set DB_PASS)  &&  npm install && npm start
   (first run seeds demo users)
3. Client:  cd client && npm install && npm run dev   -> open http://localhost:5173

Demo logins: demo/demo123 (customer), friend/friend123 (customer), employee/employee123, manager/manager123, admin/admin123
