// Attachment upload/serve routes (milestone 27, PLAN.md "File attachments").
// Thin: all storage logic lives in services/attachments.ts.

import { Router } from 'express';
import multer from 'multer';

import * as attachmentService from '../services/attachments.js';
import * as workspaceService from '../services/workspaces.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/:folder', upload.single('file'), (req, res, next) => {
  try {
    const { folder } = req.params;
    if (!attachmentService.isAttachmentFolder(folder)) {
      throw new attachmentService.AttachmentServiceError(`unknown attachment folder "${folder}"`, 400);
    }
    if (!req.file) {
      throw new attachmentService.AttachmentServiceError('no file uploaded (expected multipart field "file")', 400);
    }
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const attachment = attachmentService.saveAttachment(workspace.path, folder, req.file.originalname, req.file.buffer, 'api');
    res.status(201).json({ attachment });
  } catch (err) {
    next(err);
  }
});

router.get('/:folder/:filename', (req, res, next) => {
  try {
    const { folder, filename } = req.params;
    if (!attachmentService.isAttachmentFolder(folder)) {
      throw new attachmentService.AttachmentServiceError(`unknown attachment folder "${folder}"`, 400);
    }
    const workspace = workspaceService.getActiveWorkspaceOrThrow();
    const dir = attachmentService.attachmentsDirPath(workspace.path, folder);
    res.sendFile(filename, { root: dir }, (err) => {
      if (err) next(attachmentService.attachmentNotFoundError(folder, filename));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
