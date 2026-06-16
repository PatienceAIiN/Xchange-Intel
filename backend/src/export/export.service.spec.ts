import { ExportService } from './export.service';
import { Company } from '../companies/company.entity';

const sample = {
  name: 'Acme Technologies Pvt Ltd',
  slug: 'acme-technologies-pvt-ltd',
  cin: 'U72900KA2015PTC079758',
  llpin: null,
  website: 'https://acme.example',
  emails: ['hi@acme.example'],
  phones: ['+919876543210'],
  founders: ['Jane Doe'],
  address: 'Bengaluru, KA',
  socialLinks: { linkedin: 'https://linkedin.com/company/acme' },
  description: 'A sample company.',
  aiOverview: 'Acme builds widgets.',
  sources: ['google', 'ai'],
  raw: {},
  startupIndiaRecognised: true,
} as unknown as Company;

describe('ExportService', () => {
  const svc = new ExportService();

  it('produces CSV with header + CIN', () => {
    const csv = svc.csv(sample).toString();
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('U72900KA2015PTC079758');
  });

  it('produces valid JSON', () => {
    const obj = JSON.parse(svc.json(sample).toString());
    expect(obj.cin).toBe('U72900KA2015PTC079758');
  });

  it('produces a non-empty XLSX buffer', async () => {
    const buf = await svc.excel(sample);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('produces a PDF buffer with %PDF header', async () => {
    const buf = await svc.pdf(sample);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });
});
