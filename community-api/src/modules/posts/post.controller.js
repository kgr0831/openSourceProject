
const prisma = require("../../config/prisma");

// 게시글 작성
exports.createPost = async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        message: "제목과 내용을 모두 입력해주세요.",
      });
    }

    const post = await prisma.post.create({
      data: {
        title,
        content,
        authorId: req.session.userId,
      },
    });

    return res.status(201).json({
      message: "게시글이 작성되었습니다.",
      post,
    });
  } catch (error) {
    console.error("게시글 작성 오류:", error);
    return res.status(500).json({
      message: "게시글 작성 중 오류가 발생했습니다.",
    });
  }
};

// 전체 게시글 조회
exports.getPosts = async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        author: {
          select: {
            studentId: true,
          },
        },
      },
    });

    return res.status(200).json({ posts });
  } catch (error) {
    console.error("게시글 목록 조회 오류:", error);
    return res.status(500).json({
      message: "게시글 목록 조회 중 오류가 발생했습니다.",
    });
  }
};

// 게시글 상세 조회
exports.getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            studentId: true,
          },
        },
      },
    });

    if (!post) {
      return res.status(404).json({
        message: "게시글을 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({ post });
  } catch (error) {
    console.error("게시글 상세 조회 오류:", error);
    return res.status(500).json({
      message: "게시글 조회 중 오류가 발생했습니다.",
    });
  }
};

// 게시글 수정
exports.updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const post = await prisma.post.findUnique({
      where: { id },
    });

    if (!post) {
      return res.status(404).json({
        message: "게시글을 찾을 수 없습니다.",
      });
    }

    if (post.authorId !== req.session.userId) {
      return res.status(403).json({
        message: "게시글 작성자만 수정할 수 있습니다.",
      });
    }

    if (!title || !content) {
      return res.status(400).json({
        message: "제목과 내용을 모두 입력해주세요.",
      });
    }

    const updatedPost = await prisma.post.update({
      where: { id },
      data: { title, content },
    });

    return res.status(200).json({
      message: "게시글이 수정되었습니다.",
      post: updatedPost,
    });
  } catch (error) {
    console.error("게시글 수정 오류:", error);
    return res.status(500).json({
      message: "게시글 수정 중 오류가 발생했습니다.",
    });
  }
};

// 게시글 삭제
exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
    });

    if (!post) {
      return res.status(404).json({
        message: "게시글을 찾을 수 없습니다.",
      });
    }

    if (post.authorId !== req.session.userId) {
      return res.status(403).json({
        message: "게시글 작성자만 삭제할 수 있습니다.",
      });
    }

    await prisma.post.delete({
      where: { id },
    });

    return res.status(200).json({
      message: "게시글이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("게시글 삭제 오류:", error);
    return res.status(500).json({
      message: "게시글 삭제 중 오류가 발생했습니다.",
    });
  }
};
