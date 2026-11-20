import { createCn } from 'cn/config';

// shadcn's class joiner, told about the `rr:` prefix so it can merge prefixed classes.
export const cn = createCn({ prefix: 'rr' });
