
const prisma = require("../../config/prisma");
const bcrypt = require("bcrypt");

// 회원가입
async function signup(req, res) {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: "학번과 비밀번호를 입력해 주세요.",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { studentId },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "이미 가입된 학번입니다.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        studentId,
        passwordHash,
      },
    });

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      user: {
        id: user.id,
        studentId: user.studentId,
      },
    });
  } catch (error) {
    console.error("회원가입 오류:", error);

    return res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다.",
    });
  }
}

// 로그인
async function login(req, res) {
  try {
    const { studentId, password } = req.body;

    if (!studentId || !password) {
      return res.status(400).json({
        success: false,
        message: "학번과 비밀번호를 입력해 주세요.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { studentId },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "학번 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "학번 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // 로그인 성공: 세션에 사용자 ID 저장
    req.session.userId = user.id;

    req.session.save((error) => {
      if (error) {
        console.error("세션 저장 오류:", error);

        return res.status(500).json({
          success: false,
          message: "로그인 처리 중 오류가 발생했습니다.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "로그인에 성공했습니다.",
        user: {
          id: user.id,
          studentId: user.studentId,
        },
      });
    });
  } catch (error) {
    console.error("로그인 오류:", error);

    return res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다.",
    });
  }
}

// 로그인 상태 확인
async function getMe(req, res) {
  try {
    // 세션에 사용자 ID가 없으면 로그인하지 않은 상태
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
      });
    }

    // 세션의 사용자 ID로 DB에서 사용자 검색
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userId,
      },
      select: {
        id: true,
        studentId: true,
      },
    });

    // DB에 사용자가 존재하지 않는 경우
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "유효하지 않은 로그인 정보입니다.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "로그인 상태입니다.",
      user,
    });
  } catch (error) {
    console.error("로그인 상태 확인 오류:", error);

    return res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다.",
    });
  }
}
// 로그아웃
function logout(req, res) {
  req.session.destroy((error) => {
    if (error) {
      console.error("로그아웃 오류:", error);

      return res.status(500).json({
        success: false,
        message: "로그아웃 처리 중 오류가 발생했습니다.",
      });
    }

    // 세션 쿠키 삭제
    res.clearCookie("connect.sid");

    return res.status(200).json({
      success: true,
      message: "로그아웃되었습니다.",
    });
  });
}
module.exports = { signup, login, getMe, logout };