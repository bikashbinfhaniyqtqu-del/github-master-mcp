import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRepoUrl } from '../src/github.js';

test('parses standard HTTPS repository URL', () => {
  const result = parseGitHubRepoUrl('https://github.com/octocat/Hello-World');
  assert.equal(result.fullName, 'octocat/Hello-World');
  assert.equal(result.cloneUrl, 'https://github.com/octocat/Hello-World.git');
});

test('parses a branch URL', () => {
  const result = parseGitHubRepoUrl('https://github.com/octocat/Hello-World/tree/develop');
  assert.equal(result.branch, 'develop');
});

test('parses SSH-style URL', () => {
  const result = parseGitHubRepoUrl('git@github.com:octocat/Hello-World.git');
  assert.equal(result.fullName, 'octocat/Hello-World');
});

test('rejects non-GitHub hosts', () => {
  assert.throws(() => parseGitHubRepoUrl('https://evil.example/octocat/repo'), /Only github.com/);
});

test('rejects URLs without owner and repository', () => {
  assert.throws(() => parseGitHubRepoUrl('https://github.com/octocat'), /owner and repository/);
});
