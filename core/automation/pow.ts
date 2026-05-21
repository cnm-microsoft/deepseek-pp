import { sha3_256 } from 'js-sha3';

export interface PowChallenge {
  algorithm: string;
  challenge: string;
  salt: string;
  difficulty: number;
  signature: string;
  expireAt: number;
  expireAfter?: number;
}

export interface PowAnswer {
  algorithm: string;
  challenge: string;
  salt: string;
  answer: number;
  signature: string;
}

const SUPPORTED_ALGORITHM = 'DeepSeekHashV1';
const POW_YIELD_INTERVAL = 2_000;

export async function solvePowChallengeLocally(challenge: PowChallenge): Promise<PowAnswer> {
  validatePowChallenge(challenge);

  const target = challenge.challenge.toLowerCase();
  const prefix = `${challenge.salt}_${challenge.expireAt}_`;

  for (let answer = 0; answer < challenge.difficulty; answer++) {
    if (sha3_256(`${prefix}${answer}`) === target) {
      return {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer,
        signature: challenge.signature,
      };
    }

    if (answer > 0 && answer % POW_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  throw new Error(`No DeepSeek PoW solution found before difficulty ${challenge.difficulty}.`);
}

function validatePowChallenge(challenge: PowChallenge) {
  if (challenge.algorithm !== SUPPORTED_ALGORITHM) {
    throw new Error(`Unsupported DeepSeek PoW algorithm: ${challenge.algorithm}`);
  }

  if (!/^[0-9a-f]+$/i.test(challenge.challenge) || challenge.challenge.length % 2 !== 0) {
    throw new Error('Invalid DeepSeek PoW challenge digest.');
  }

  if (!Number.isSafeInteger(challenge.difficulty) || challenge.difficulty <= 0) {
    throw new Error(`Invalid DeepSeek PoW difficulty: ${challenge.difficulty}`);
  }

  if (!Number.isFinite(challenge.expireAt) || challenge.expireAt <= 0) {
    throw new Error(`Invalid DeepSeek PoW expireAt: ${challenge.expireAt}`);
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
