export function fmt(label, data) {
  const str = JSON.stringify(data, null, 2);
  const indented = str.replace(/\n/g, '\n    ');
  console.log(`\n  [${label}]\n    ${indented}`);
}
