"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaunchService = void 0;
const curve_engine_1 = require("../engines/curve.engine");
class LaunchService {
    async analyze(tokenMint) {
        return (0, curve_engine_1.analyzeLaunch)(tokenMint);
    }
}
exports.LaunchService = LaunchService;
