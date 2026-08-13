#!/usr/bin/env node

import "dotenv/config";
import { runCli } from "./cli/run.js";

process.exitCode = await runCli();
