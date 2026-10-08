import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureKey, hasFeature } from '../features';

export const FEATURE_KEY = 'required_feature';

/** Gắn lên controller hoặc handler: chặn 403 khi tính năng không thuộc gói (APP_TIER). */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;
    if (!hasFeature(feature)) {
      throw new ForbiddenException('Tính năng này không thuộc gói triển khai hiện tại.');
    }
    return true;
  }
}
