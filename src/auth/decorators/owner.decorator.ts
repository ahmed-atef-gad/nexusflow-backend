import { SetMetadata } from '@nestjs/common';

export const IS_OWNER_CHECK_KEY = 'isOwnerCheck';

// A simple marker decorator to tell the guard to run the logic
export const IsOwner = () => SetMetadata(IS_OWNER_CHECK_KEY, true);