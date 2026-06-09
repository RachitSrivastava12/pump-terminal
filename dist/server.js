"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const launch_route_1 = __importDefault(require("./routes/launch.route"));
const config_1 = require("./config");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api', launch_route_1.default);
app.get('/health', (req, res) => {
    res.json({ status: 'ok', rpc: config_1.connection.rpcEndpoint.substring(0, 40) + '...' });
});
app.listen(PORT, () => {
    console.log(`🚀 Pump Launch Terminal running on http://localhost:${PORT}`);
    console.log(`POST /api/launch with { "tokenMint": "..." }`);
});
