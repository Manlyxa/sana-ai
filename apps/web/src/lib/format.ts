/** «234000000» тиын → «2 340 000 ₸» (целые тенге, HALF_UP на границе UI). */
export function tiynToTenge(tiynText: string): string {
  const tiyn = BigInt(tiynText);
  const negative = tiyn < 0n;
  const abs = negative ? -tiyn : tiyn;
  const tenge = (abs + 50n) / 100n; // округление до тенге
  const grouped = tenge.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '−' : ''}${grouped} ₸`;
}
