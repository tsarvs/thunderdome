#!/usr/bin/env node
import { runBot } from './harness.mjs';
import { decideAction } from './strategy.mjs';

runBot({ decideAction });
