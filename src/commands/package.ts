import shell from "shelljs";
import path from "node:path";
import pfs from "node:fs/promises";

import cli from "../cli.js";

cli.command(
  "package [dir]",
  "Package a folder into a .pwa",
  (yargs) => {
    return yargs
      .positional("dir", {
        describe: "the directory to pack",
        default: "./dist",
      })
      .option("app-name", {
        alias: "n",
        type: "string",
        description: "The name of the app",
      })
      .option("app-version", {
        alias: "v",
        type: "string",
        description: "The version of the app",
      })
      .option("package", {
        alias: "p",
        type: "string",
        description: "Get the name and version from a package.json",
      })
      .demandOption("dir");
  },
  async (argv) => {
    let name = "unknown";
    let version = "";

    if (argv.package) {
      const packagePath = path.isAbsolute(argv.package) ? argv.package : path.relative(process.cwd(), argv.package);

      if (argv.verbose) console.log(`Reading package.json ${packagePath}`);
      const pkg = JSON.parse(await pfs.readFile(packagePath, { encoding: "utf-8" }));
      name = pkg.name;
      version = pkg.version;
    } else if (argv.appName && argv.appVersion) {
      name = argv.appName;
      version = argv.appVersion;
    } else throw new Error("Missing app-name, app-version or package");

    const output = `${name}_${version.replaceAll(/\./g, "-")}.pwa`;
    if (argv.verbose) console.log(`Packaging ${argv.dir} into ${output}`);

    // remove the old file
    try {
      await pfs.stat(output);
      if (argv.verbose) console.log(`Removing existing ${output}`);
      shell.rm(output);
    } catch (e) {}

    // zip folder
    let flags = "rX";
    if (!argv.verbose) flags += "q";
    shell.cd(argv.dir);
    shell.exec(`zip -${flags} ../${output} *`);
    shell.cd("../");

    console.log("Created", output);
  },
);
