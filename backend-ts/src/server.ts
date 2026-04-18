import { createAppServer } from "./app.ts";
import { ensureKnowledgeArtifacts } from "./services/knowledge-bootstrap.ts";

const DEFAULT_PORT = 8788;

function resolvePort(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const port = resolvePort(process.env.PORT);
  const knowledgeStatus = await ensureKnowledgeArtifacts("tech_docs");
  if (knowledgeStatus.generated) {
    console.log("knowledge artifacts generated for tech_docs");
  }
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`nc-backend-ts listening on http://127.0.0.1:${port}`);
  });
}

void main();
