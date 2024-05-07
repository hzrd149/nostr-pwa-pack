#!/usr/bin/env node
import "./polyfill.js";
import shell from "shelljs";

import cli from "./cli.js";
import "./commands/connect.js";
import "./commands/package.js";
import "./commands/publish.js";

if (!shell.which("zip")) {
  shell.echo("Missing zip");
  shell.exit(1);
}

cli
  .option("verbose", {
    type: "boolean",
    description: "Run with verbose logging",
  })
  .demandCommand(1)
  .help("h")
  .alias("h", "help")
  .parse();
