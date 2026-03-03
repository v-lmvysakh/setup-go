import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import path from 'path';
import fs from 'fs';

import {State, Outputs} from './constants';
import {PackageManagerInfo} from './package-managers';
import {getCacheDirectoryPath, getPackageManagerInfo} from './cache-utils';

export const restoreCache = async (
  versionSpec: string,
  packageManager: string,
  cacheDependencyPath?: string
) => {
  const packageManagerInfo = await getPackageManagerInfo(packageManager);
  const platform = process.env.RUNNER_OS;
  const arch = process.arch;

  const cachePaths = await getCacheDirectoryPath(packageManagerInfo);

  const dependencyFilePath = cacheDependencyPath
    ? cacheDependencyPath
    : findDependencyFile(packageManagerInfo);
  const fileHash = await glob.hashFiles(dependencyFilePath);

  if (!fileHash) {
    throw new Error(
      'Some specified paths were not resolved, unable to cache dependencies.'
    );
  }

  const linuxVersion =
    process.env.RUNNER_OS === 'Linux' ? `${process.env.ImageOS}-` : '';
  const primaryKey = `setup-go-${platform}-${arch}-${linuxVersion}go-${versionSpec}-${fileHash}`;
  core.debug(`primary key is ${primaryKey}`);

  core.saveState(State.CachePrimaryKey, primaryKey);

  const allPathsPopulated = cachePaths.every(cachePath => {
    try {
      if (fs.existsSync(cachePath) && fs.statSync(cachePath).isDirectory()) {
        const entries = fs.readdirSync(cachePath);
        return entries.length > 0;
      }
    } catch {
      // ignore errors checking paths
    }
    return false;
  });

  if (allPathsPopulated) {
    core.info(
      `Cache paths already populated on disk, skipping restore to avoid overwrite errors (key: ${primaryKey}).`
    );
    core.setOutput(Outputs.CacheHit, true);
    // core.saveState(State.CacheMatchedKey, primaryKey);
    return;
  }

  const cacheKey = await cache.restoreCache(cachePaths, primaryKey);
  core.setOutput(Outputs.CacheHit, Boolean(cacheKey));

  if (!cacheKey) {
    core.info(`Cache is not found`);
    core.setOutput(Outputs.CacheHit, false);
    return;
  }

  core.saveState(State.CacheMatchedKey, cacheKey);
  core.info(`Cache restored from key: ${cacheKey}`);
};

const findDependencyFile = (packageManager: PackageManagerInfo) => {
  const dependencyFile = packageManager.dependencyFilePattern;
  const workspace = process.env.GITHUB_WORKSPACE!;
  const rootContent = fs.readdirSync(workspace);

  const goModFileExists = rootContent.includes(dependencyFile);
  if (!goModFileExists) {
    throw new Error(
      `Dependencies file is not found in ${workspace}. Supported file pattern: ${dependencyFile}`
    );
  }

  return path.join(workspace, dependencyFile);
};
