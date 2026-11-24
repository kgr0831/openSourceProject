
const express = require("express");
const router = express.Router();

const postController = require("./post.controller");

// 로그인 여부 확인
const requireLogin = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      message: "로그인이 필요합니다.",
    });
  }

  next();
};

// 게시글 작성
router.post("/", requireLogin, postController.createPost);

// 전체 게시글 조회
router.get("/", postController.getPosts);

// 게시글 상세 조회
router.get("/:id", postController.getPostById);

// 게시글 수정
router.put("/:id", requireLogin, postController.updatePost);

// 게시글 삭제
router.delete("/:id", requireLogin, postController.deletePost);

module.exports = router;
