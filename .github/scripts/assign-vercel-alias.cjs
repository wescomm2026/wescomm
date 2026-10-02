const deploymentUrl = process.argv[2];
const alias = process.argv[3];
const token = process.env.VERCEL_TOKEN;
const teamId = process.env.VERCEL_ORG_ID;

if (!deploymentUrl || !alias) {
  console.error(
    "Usage: node assign-vercel-alias.cjs <deployment-url> <alias>",
  );
  process.exit(2);
}

if (!token || !teamId) {
  console.error("VERCEL_TOKEN and VERCEL_ORG_ID are required.");
  process.exit(2);
}

let deployment;
try {
  deployment = new URL(deploymentUrl).hostname;
} catch {
  console.error("The deployment URL is invalid.");
  process.exit(2);
}

const endpoint = new URL(
  `https://api.vercel.com/v2/deployments/${encodeURIComponent(deployment)}/aliases`,
);
endpoint.searchParams.set("teamId", teamId);

async function assignAlias() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ alias }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The HTTP status still provides a safe, actionable failure message.
  }

  if (!response.ok) {
    const errorCode = payload?.error?.code;
    const suffix = errorCode ? ` (${errorCode})` : "";
    console.error(`Unable to assign the Staging alias: HTTP ${response.status}${suffix}.`);
    process.exit(1);
  }

  if (payload.alias !== alias) {
    console.error("Vercel did not confirm the requested Staging alias.");
    process.exit(1);
  }

  console.log(`Assigned ${alias} to the new Staging deployment.`);
}

assignAlias().catch((error) => {
  console.error(`Unable to assign the Staging alias: ${error.message}`);
  process.exit(1);
});
