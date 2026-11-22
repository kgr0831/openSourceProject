
require("dotenv").config();

const prisma = require("./src/config/prisma");

async function testConnection() {
  try {
    await prisma.$connect();
    console.log("Neon 데이터베이스 연결 성공!");
  } catch (error) {
    console.error("데이터베이스 연결 실패:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
