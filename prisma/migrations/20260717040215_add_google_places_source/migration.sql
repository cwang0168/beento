-- AlterEnum
ALTER TYPE "PlaceSource" ADD VALUE 'google_places';

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Place_externalId_key" ON "Place"("externalId");

