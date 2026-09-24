import { createClient } from "redis";

const globalRedis = globalThis as typeof globalThis & {
  filmRedis?: ReturnType<typeof createClient>;
};

export const redis = globalRedis.filmRedis || createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

redis.on("error", (error) => console.error("[redis]", error.message));

if (process.env.NODE_ENV !== "production") globalRedis.filmRedis = redis;

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect();
  return redis;
}

export const imageQueueKey = "film:queue:image";
export const messageStreamKey = "film:stream:messages";
export const imageJobKey = (id: string) => `film:job:image:${id}`;
