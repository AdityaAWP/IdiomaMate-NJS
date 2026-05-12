-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ENGLISH', 'SPANISH', 'KOREAN', 'JAPANESE', 'ARABIC', 'RUSSIAN', 'MANDARIN', 'FRENCH');

-- AlterTable users: drop old varchar column, add new enum column
ALTER TABLE "users" DROP COLUMN "targetLanguage",
ADD COLUMN "targetLanguage" "Language";

-- AlterTable lobbies: drop old varchar column, add new enum column
ALTER TABLE "lobbies" DROP COLUMN "language",
ADD COLUMN "language" "Language" NOT NULL DEFAULT 'ENGLISH';

-- Remove the default (it was only needed to satisfy NOT NULL on existing rows)
ALTER TABLE "lobbies" ALTER COLUMN "language" DROP DEFAULT;
