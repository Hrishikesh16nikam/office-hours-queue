// A demo course for trying the app locally:
//   npm run demo && npm run build && npm run local
// Sign in as ta@example.edu with PIN 246810.
import { localQueue } from './local.ts';

const { queue } = await localQueue();
if (await queue.isSetUp()) {
  console.log('A course already exists in data/local.db. Delete the data folder to start over.');
  process.exit(0);
}
const admin = await queue.setup({
  courseName: 'EECE 2540 Fundamentals of Networks, Section 02', emailDomain: 'northeastern.edu', timezone: 'America/New_York',
  topics: ['Programming assignment', 'Homework', 'Lecture concepts', 'Exam prep', 'Other'], fairnessMinutes: 15,
  adminName: 'Hrishikesh', adminEmail: 'ta@example.edu', adminPin: '246810',
});
const s = await queue.openSession(admin.id, {
  title: 'Tuesday office hours', mode: 'hybrid', location: 'Snell 033', onlineLink: 'https://example.zoom.us/j/123456789', durationMinutes: 180,
});
const students = [
  ['Asha', 'Programming assignment', 'in_person', 'Socket closes before the reply arrives', 'Back row'],
  ['Ben', 'Lecture concepts', 'online', 'Why does TCP need a three-way handshake?', 'Ben K'],
  ['Chen', 'Programming assignment', 'in_person', 'select() returns but no data', 'Table 3'],
  ['Diego', 'Homework', 'online', 'Question 4: subnet sizes', 'Diego'],
  ['Elif', 'Exam prep', 'in_person', 'Going over last year\u2019s midterm', 'Front'],
];
for (const [i, [name, topic, mode, description, where]] of students.entries()) {
  await queue.join(s.joinCode, { name, email: `${name.toLowerCase()}@northeastern.edu`, topic, mode, description, where }, `demo-${i}`);
}
console.log(`Demo course ready. Join code ${s.joinCode}. TA sign-in: ta@example.edu / PIN 246810. Then: npm run build && npm run local`);
