import { createApp } from "./server/app";
import { startServer } from "./server/index";

export { createApp, startServer };

if (require.main === module) {
  startServer();
}
