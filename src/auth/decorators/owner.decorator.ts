import { SetMetadata, applyDecorators } from '@nestjs/common';

export const IS_OWNER_CHECK_KEY = 'isOwnerCheck';
export const OWNER_PARAM_KEY = 'ownerParamKey';
export const OWNER_RESOURCE_KEY = 'ownerResourceKey';

export type OwnerResource = 'user' | 'flow' | 'device' | 'deviceToken';

type IsOwnerOptions = {
  paramKey?: string;
  resource?: OwnerResource;
};

// Mark a route as owner-protected and optionally specify param key/resource type
export const IsOwner = (options?: string | IsOwnerOptions) => {
  let paramKey = 'id';
  let resource: OwnerResource = 'user';

  if (typeof options === 'string') {
    paramKey = options;
  } else if (options) {
    if (options.paramKey) paramKey = options.paramKey;
    if (options.resource) resource = options.resource;
  }

  return applyDecorators(
    SetMetadata(IS_OWNER_CHECK_KEY, true),
    SetMetadata(OWNER_PARAM_KEY, paramKey),
    SetMetadata(OWNER_RESOURCE_KEY, resource)
  );
};
