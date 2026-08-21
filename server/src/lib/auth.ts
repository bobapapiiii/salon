import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export interface StaffTokenPayload {
  userId: string;
  salonId: string;
  title: string;
}

function secret(): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set -- copy server/.env.example to server/.env and fill it in.");
  }
  return JWT_SECRET;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "30d" });
}

export function verifyStaffToken(token: string): StaffTokenPayload {
  return jwt.verify(token, secret()) as StaffTokenPayload;
}
