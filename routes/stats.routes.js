const express = require('express');
const statsController = require('../controllers/stats.controller');

const router = express.Router();

router.get('/', statsController.getPublicStats);

module.exports = router;
