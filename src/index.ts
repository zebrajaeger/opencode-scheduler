import { Plugin } from "@opencode/plugin";
import { setup } from "./opencode-adapter.js";

export default Plugin.define({
  id: "zebrajaeger.opencode-scheduler",
  setup,
});
