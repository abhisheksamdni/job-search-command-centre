export function visibleJobPredicate(alias='j'){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw new Error('Invalid SQL alias');
  return `(${alias}.role_classification IN ('ROLE_MATCH','ROLE_RELATED') OR ${alias}.application_override_at IS NOT NULL)`;
}
