import { describe, it, expect } from 'vitest';
import {
  isPrRequest,
  isBranchOnlyRequest,
  suggestBranchName,
  defaultBranchName,
} from '../../../src/cli/session/slash/pr-handler.js';
import { VERSION } from '../../../src/constants.js';

describe('pr-handler', () => {
  describe('isBranchOnlyRequest', () => {
    it('detects branch-for-PR setup without immediate PR', () => {
      expect(isBranchOnlyRequest('crearte branch for creating the pull request')).toBe(true);
      expect(isBranchOnlyRequest('create a new branch for the PR')).toBe(true);
    });

    it('does not treat explicit PR creation as branch-only', () => {
      expect(isBranchOnlyRequest('create a pull request')).toBe(false);
      expect(isBranchOnlyRequest('create branch and then create pr')).toBe(false);
    });
  });

  describe('isPrRequest', () => {
    it('detects natural-language PR requests', () => {
      expect(isPrRequest('can we create PR now with new branch name')).toBe(true);
      expect(isPrRequest('create a pull request')).toBe(true);
      expect(isPrRequest('open pr please')).toBe(true);
      expect(isPrRequest('create branch and then create pr')).toBe(true);
    });

    it('does not match branch-only setup', () => {
      expect(isPrRequest('crearte branch for creating the pull request')).toBe(false);
    });

    it('does not match unrelated queries', () => {
      expect(isPrRequest('explain the auth module')).toBe(false);
      expect(isPrRequest('create a user profile page')).toBe(false);
    });
  });

  describe('suggestBranchName', () => {
    it('uses version convention when user mentions versions', () => {
      expect(suggestBranchName('create pr with same versions we are following')).toBe(
        `release/v${VERSION}`,
      );
    });

    it('parses explicit branch names', () => {
      expect(suggestBranchName('create pr on branch chore/my-feature')).toBe('chore/my-feature');
    });

    it('does not treat "for" as a branch name', () => {
      expect(suggestBranchName('crearte branch for creating the pull request')).toBeNull();
    });

    it('parses "branch name called …"', () => {
      expect(suggestBranchName('create a pr with branch name called 1st-pr-with-koda')).toBe(
        '1st-pr-with-koda',
      );
    });

    it('parses "with branch name pr-with-koda"', () => {
      expect(suggestBranchName('create pull request with the branch name pr-with-koda')).toBe(
        'pr-with-koda',
      );
    });

    it('does not treat the word "name" as a branch', () => {
      expect(suggestBranchName('create pr with branch name called foo')).not.toBe('name');
    });
  });

  describe('defaultBranchName', () => {
    it('generates feat/pr prefix for PR-related hints', () => {
      expect(defaultBranchName('branch for pull request')).toMatch(/^feat\/pr-/);
    });
  });
});
