import Yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

const cli = Yargs(hideBin(process.argv));

export default cli;
