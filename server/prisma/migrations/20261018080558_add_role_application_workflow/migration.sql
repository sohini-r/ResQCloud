-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "applicationRejectionReason" TEXT,
ADD COLUMN     "applicationReviewedAt" TIMESTAMP(3),
ADD COLUMN     "applicationReviewedById" TEXT,
ADD COLUMN     "applicationSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "requestedRole" "UserRole";

-- CreateIndex
CREATE INDEX "User_accountStatus_applicationSubmittedAt_idx" ON "User"("accountStatus", "applicationSubmittedAt");

-- CreateIndex
CREATE INDEX "User_applicationReviewedById_idx" ON "User"("applicationReviewedById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_applicationReviewedById_fkey" FOREIGN KEY ("applicationReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
