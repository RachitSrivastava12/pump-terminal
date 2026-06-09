"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const launch_service_1 = require("../services/launch.service");
const router = (0, express_1.Router)();
const service = new launch_service_1.LaunchService();
router.post('/launch', async (req, res) => {
    try {
        const { tokenMint } = req.body;
        if (!tokenMint || typeof tokenMint !== 'string') {
            return res.status(400).json({ error: 'tokenMint is required (string)' });
        }
        const analysis = await service.analyze(tokenMint);
        res.json(analysis);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
exports.default = router;
