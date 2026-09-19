import { handleInboundEmail, type MailRouterEnv } from "./handler";

export default {
  async email(message: ForwardableEmailMessage, env: MailRouterEnv): Promise<void> {
    await handleInboundEmail(message, env);
  },
};
