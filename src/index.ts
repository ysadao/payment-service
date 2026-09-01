import { config } from "./config.js";
import { createApp } from "./app.js";
import { createContext } from "./context.js";

const app = createApp(createContext());
app.listen(config.port, () => {
  console.log(`Ledger operator console on http://127.0.0.1:${config.port}`);
});
