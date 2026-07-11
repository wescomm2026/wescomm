import { prisma } from "../lib/prisma.js";
import {
  decryptSensitiveText,
  encryptedValueVersion,
  hashHighEntropyLookup,
  reencryptSensitiveText
} from "../utils/field-encryption.js";
import { env } from "../config/env.js";

const applyChanges = process.argv.includes("--apply");

function needsEncryption(value: string | null | undefined) {
  return Boolean(value) && encryptedValueVersion(value) !== env.DATA_ENCRYPTION_CURRENT_VERSION;
}

async function main() {
  const [profiles, conversations, messages, pushSubscriptions] = await Promise.all([
    prisma.profile.findMany({ select: { id: true, phone: true, address: true } }),
    prisma.conversation.findMany({ select: { id: true, subject: true } }),
    prisma.conversationMessage.findMany({ select: { id: true, message: true } }),
    prisma.pushSubscription.findMany({
      select: { id: true, endpoint: true, endpointHash: true, p256dh: true, auth: true }
    })
  ]);

  const profileUpdates = profiles.filter(
    (profile) =>
      needsEncryption(profile.phone) || needsEncryption(profile.address)
  );
  const conversationUpdates = conversations.filter(
    (conversation) => needsEncryption(conversation.subject)
  );
  const messageUpdates = messages.filter(
    (message) => needsEncryption(message.message)
  );
  const pushUpdates = pushSubscriptions.filter(
    (subscription) =>
      !subscription.endpointHash ||
      needsEncryption(subscription.endpoint) ||
      needsEncryption(subscription.p256dh) ||
      needsEncryption(subscription.auth)
  );

  console.log("Sensitive-data encryption audit");
  console.log(`Profiles requiring encryption: ${profileUpdates.length}`);
  console.log(`Conversation subjects requiring encryption: ${conversationUpdates.length}`);
  console.log(`Support messages requiring encryption: ${messageUpdates.length}`);
  console.log(`Push subscriptions requiring encryption: ${pushUpdates.length}`);

  if (!applyChanges) {
    console.log("Dry run only. Run npm run security:encrypt-existing -- --apply to encrypt these records.");
    return;
  }

  for (const profile of profileUpdates) {
    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        phone: profile.phone ? reencryptSensitiveText(profile.phone, "profile.phone") : null,
        address: profile.address ? reencryptSensitiveText(profile.address, "profile.address") : null,
        updatedAt: new Date()
      }
    });
  }

  for (const conversation of conversationUpdates) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { subject: reencryptSensitiveText(conversation.subject, "conversation.subject")! }
    });
  }

  for (const message of messageUpdates) {
    await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { message: reencryptSensitiveText(message.message, "conversation.message")! }
    });
  }

  for (const subscription of pushUpdates) {
    const plaintextEndpoint = decryptSensitiveText(subscription.endpoint, "push.endpoint");
    if (!plaintextEndpoint) {
      throw new Error(`Push subscription ${subscription.id} has no endpoint available for migration.`);
    }

    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: {
        endpointHash: subscription.endpointHash ?? hashHighEntropyLookup(plaintextEndpoint, "push.endpoint"),
        endpoint: reencryptSensitiveText(subscription.endpoint, "push.endpoint")!,
        p256dh: reencryptSensitiveText(subscription.p256dh, "push.p256dh")!,
        auth: reencryptSensitiveText(subscription.auth, "push.auth")!,
        updatedAt: new Date()
      }
    });
  }

  console.log("Sensitive records encrypted successfully.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Sensitive-data encryption failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
