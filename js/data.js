// Current-season data copied from alhambrasoccer.org (View Scores and Goleadores) on Nov 1, 2026.
// Each line: date | time slot | field | home | away | score

const DIVISIONS = [
  { id: '40', name: '40+', group: 'adult', day: 'Sun' },
  { id: 'varonil', name: 'Varonil', group: 'adult', day: 'Sun' },
  { id: 'femenil', name: 'Femenil', group: 'adult', day: 'Sun' },
  { id: 'u5', name: 'U-5', group: 'youth', day: 'Sun' },
  { id: 'u7', name: 'U-7', group: 'youth', day: 'Sun' },
  { id: 'u9', name: 'U-9', group: 'youth', day: 'Sun' },
  { id: 'u11', name: 'U-11', group: 'youth', day: 'Sun' },
  { id: 'u13', name: 'U-13', group: 'youth', day: 'Sun' },
  { id: 'u15', name: 'U-15', group: 'youth', day: 'Sun' },
  { id: 'u17', name: 'U-17', group: 'youth', day: 'Sun' },
  { id: 'u19', name: 'U-19', group: 'youth', day: 'Sun' },
  { id: 'fwednesdays', name: 'Futsal Wednesdays', es: 'Futsal Miércoles', group: 'futsal', day: 'Wed' },
  { id: 'fthursdays', name: 'Futsal Thursdays', es: 'Futsal Jueves', group: 'futsal', day: 'Thu' },
];

// Each division runs its own season; these are the seasons the old site was on.
const SEASON_NAMES = { varonil: '2026/2027', fwednesdays: 'Season 7', fthursdays: 'Season 1' };
const defaultSeason = div => SEASON_NAMES[div] || 'Winter 2026';

// Team logos that come with the site, by team name (one club, same logo in every division).
const TEAM_LOGOS = {
  'Alhambra FC': 'images/logos/alhambra-fc.png',
  'Alhambra United': 'images/logos/alhambra-united.png',
  'Barcelona': 'images/logos/barcelona.png',
  'Jrs FC': 'images/logos/jrs-fc.png',
  'LA Alhambra': 'images/logos/la-alhambra.png',
  'LA Esperanza': 'images/logos/la-esperanza.png',
  'Los Selectos FC': 'images/logos/los-selectos-fc.png',
  'Unamitas FC': 'images/logos/unamitas-fc.png',
  'Unamitas Elite': 'images/logos/unamitas-fc.png',
  'Unamitas Premier': 'images/logos/unamitas-fc.png',
  'Wolfs FC': 'images/logos/wolfs-fc.png',
  'Cazadores FC': 'images/logos/teams/cazadores-fc-eec63b.png',
};

// Division-specific exceptions ("division|team"): '' means no logo there.
// Femenil's Unamitas FC is a different team from the other Unamitas sides.
const LOGO_EXCEPTIONS = {
  'femenil|Unamitas FC': '',
};

// Team logos from the league's Drive folder (one folder per division), by "division|team".
// These come before the club-wide logos above, so a division can have its own.
const DIVISION_LOGOS = {
  '40|Atlante': 'images/logos/teams/atlante-df1dcd.png',
  '40|Barcelona': 'images/logos/teams/barcelona-9b4e48.png',
  '40|Bufalos': 'images/logos/teams/bufalos-fc-9e9e2d.png',
  '40|C.D. Ajax': 'images/logos/teams/cd-ajax-b252c5.png',
  '40|Colima FC': 'images/logos/teams/colima-fc-ed2ebf.png',
  '40|Dep Miramar': 'images/logos/teams/dep-miramar-c5fecd.png',
  '40|Francisquense FC': 'images/logos/teams/francisquense-fc-f4fad6.png',
  '40|Ixtac': 'images/logos/teams/ixtac-7d767b.png',
  '40|LA City': 'images/logos/teams/la-city-9ec53e.png',
  '40|Manchester United': 'images/logos/teams/manchester-united-0be232.png',
  '40|Monarcas': 'images/logos/teams/monarcas-ef07f5.png',
  '40|Nazareno FC': 'images/logos/teams/nazareno-6aa64b.png',
  '40|Rebano Tuzo': 'images/logos/teams/tuzos-c69e9c.png',
  '40|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  '40|Wolfs FC': 'images/logos/teams/wolfs-fc-974a1b.png',
  'femenil|Acapulco SC': 'images/logos/teams/acapulco-1f6afb.png',
  'femenil|Aztecas FC': 'images/logos/teams/aztecas-fc-6b67bf.png',
  'femenil|Dep Samayoa FC': 'images/logos/teams/dep-samayoa-3666a0.png',
  'femenil|Girls Game LA': 'images/logos/teams/girls-game-la-40062d.png',
  'femenil|Guerreras FC': 'images/logos/teams/guerreras-fc-3f4482.png',
  'femenil|LAFC7': 'images/logos/teams/lafc7-ec11bd.png',
  'femenil|Lady Angels': 'images/logos/teams/lady-angels-9c25c2.png',
  'femenil|Las Damas de LC': 'images/logos/teams/las-damas-dlc-51c4cd.png',
  'femenil|Unamitas FC': 'images/logos/teams/unamitas-fc-67f286.png',
  'u11|Alhambra FC': 'images/logos/teams/alhambra-fc-03f13d.png',
  'u11|Angelinos FC': 'images/logos/teams/angelinos-fc-93464c.png',
  'u11|Barcelona': 'images/logos/teams/barcelona-9b4e48.png',
  'u11|EMC FC': 'images/logos/teams/emc-academy-5b8fc2.png',
  'u11|Escuela River': 'images/logos/teams/escuela-river-la-a5d52c.png',
  'u11|Fenix LA': 'images/logos/teams/fenix-la-c05b78.png',
  'u11|Fieras LA FC': 'images/logos/teams/fieras-la-fc-c36cb6.png',
  'u11|Inter Milan': 'images/logos/teams/inter-milan-eac389.png',
  'u11|Jrs FC': 'images/logos/teams/jr-s-fc-921005.png',
  'u11|LA Alhambra': 'images/logos/teams/la-alhambra-e889ec.png',
  'u11|LA Juve': 'images/logos/teams/la-juve-963147.png',
  'u11|Los Selectos FC': 'images/logos/teams/los-selectos-fc-9558bd.png',
  'u11|South Central United FC': 'images/logos/teams/south-central-united-061160.png',
  'u11|Titans United FC': 'images/logos/teams/titans-united-fc-21a6d5.png',
  'u11|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u11|Wolfs FC': 'images/logos/teams/wolfs-fc-974a1b.png',
  'u13|Aguilitas': 'images/logos/teams/aguilas-fc-bd7ea0.png',
  'u13|Alhambra FC': 'images/logos/teams/alhambra-fc-03f13d.png',
  'u13|Angelinos FC': 'images/logos/teams/angelinos-fc-93464c.png',
  'u13|Barcelona': 'images/logos/teams/barcelona-9b4e48.png',
  'u13|Escuela River': 'images/logos/teams/escuela-river-la-a5d52c.png',
  'u13|Fenix LA': 'images/logos/teams/fenix-la-c05b78.png',
  'u13|Flamenco FC': 'images/logos/teams/flamenco-fc-d1cf40.png',
  'u13|Inter Milan': 'images/logos/teams/inter-milan-eac389.png',
  'u13|LA Esperanza': 'images/logos/teams/la-esperanza-71f217.png',
  'u13|LA Juve': 'images/logos/teams/la-juve-963147.png',
  'u13|LA Masia': 'images/logos/teams/la-masia-8eeaf0.png',
  'u13|Los Selectos FC': 'images/logos/teams/los-selectos-fc-9558bd.png',
  'u13|Pumas Academy': 'images/logos/teams/pumas-academy-8c8fb4.png',
  'u13|Titans United FC': 'images/logos/teams/titans-united-fc-21a6d5.png',
  'u13|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u13|Union FC': 'images/logos/teams/union-fc-c56996.png',
  'u13|Wolfs FC': 'images/logos/teams/wolfs-fc-974a1b.png',
  'u15|Aguilitas A': 'images/logos/teams/aguilas-fc-bd7ea0.png',
  'u15|Aguilitas B': 'images/logos/teams/aguilas-fc-bd7ea0.png',
  'u15|Alhambra FC': 'images/logos/teams/alhambra-fc-03f13d.png',
  'u15|Angelinos FC': 'images/logos/teams/angelinos-fc-93464c.png',
  'u15|Atletico Morelia': 'images/logos/teams/atletico-morelia-ca53ac.png',
  'u15|EMC FC': 'images/logos/teams/emc-academy-5b8fc2.png',
  'u15|Escuela River': 'images/logos/teams/escuela-river-la-a5d52c.png',
  'u15|FC Boyle Heights': 'images/logos/teams/boyle-heights-fc-bafb6b.png',
  'u15|Fieras LA FC': 'images/logos/teams/fieras-la-fc-c36cb6.png',
  'u15|Flamenco FC': 'images/logos/teams/flamenco-fc-d1cf40.png',
  'u15|Invictus FC': 'images/logos/teams/invictus-fc-7a7c28.png',
  'u15|LA Esperanza': 'images/logos/teams/la-esperanza-71f217.png',
  'u15|LA Juniors': 'images/logos/teams/la-juniors-8829d8.png',
  'u15|Legacy XI': 'images/logos/teams/legacy-xi-c227d4.png',
  'u15|Pumas Academy': 'images/logos/teams/pumas-academy-8c8fb4.png',
  'u15|Santa Cruz Thunder': 'images/logos/teams/santa-cruz-thunder-9ec716.png',
  'u15|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u15|Wolfs FC': 'images/logos/teams/wolfs-fc-974a1b.png',
  'u17|Atletico Morelia': 'images/logos/teams/atletico-morelia-ca53ac.png',
  'u17|Barcelona': 'images/logos/teams/barcelona-9b4e48.png',
  'u17|FC Portugal': 'images/logos/teams/fc-portugal-7c39e9.png',
  'u17|Fieras LA FC': 'images/logos/teams/fieras-la-fc-c36cb6.png',
  'u17|Galaxy': 'images/logos/teams/galaxy-67bb23.png',
  'u17|LA City': 'images/logos/teams/la-city-9ec53e.png',
  'u17|LA Juve': 'images/logos/teams/la-juve-963147.png',
  'u17|Real Azul FC': 'images/logos/teams/real-azul-fc-aa9b15.png',
  'u17|Santos FC': 'images/logos/teams/santos-fc-87723c.png',
  'u17|Universitario Nacional': 'images/logos/teams/universitario-nacional-47372f.png',
  'u19|Atletico FC': 'images/logos/teams/atleticos-fc-ad9d73.png',
  'u19|Atletico Morelia': 'images/logos/teams/atletico-morelia-ca53ac.png',
  'u19|Cracks FC': 'images/logos/teams/cracks-fc-1df7d9.png',
  'u19|Francisquense FC': 'images/logos/teams/francisquense-fc-f4fad6.png',
  'u19|Humildes FC': 'images/logos/teams/humildes-fc-140219.png',
  'u19|LA City': 'images/logos/teams/la-city-9ec53e.png',
  'u19|LA Juve': 'images/logos/teams/la-juve-963147.png',
  'u19|Lobos FC': 'images/logos/teams/lobos-fc-278cd6.png',
  'u19|Santos FC': 'images/logos/teams/santos-fc-87723c.png',
  'u19|Universitario Nacional': 'images/logos/teams/universitario-nacional-47372f.png',
  'u5|Alhambra United': 'images/logos/teams/alhambra-united-7f1808.png',
  'u5|Los Selectos FC': 'images/logos/teams/los-selectos-fc-9558bd.png',
  'u5|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u7|Alhambra United': 'images/logos/teams/alhambra-united-7f1808.png',
  'u7|Fieras LA FC': 'images/logos/teams/fieras-la-fc-c36cb6.png',
  'u7|Force FC': 'images/logos/teams/force-fc-e9b13b.png',
  'u7|Leon FC': 'images/logos/teams/leon-fc-486bfa.png',
  'u7|Little Monster SC': 'images/logos/teams/little-monsters-sc-704380.png',
  'u7|Los Selectos FC': 'images/logos/teams/los-selectos-fc-9558bd.png',
  'u7|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u9|Alhambra FC': 'images/logos/teams/alhambra-fc-03f13d.png',
  'u9|Alhambra United': 'images/logos/teams/alhambra-united-7f1808.png',
  'u9|Escuela River': 'images/logos/teams/escuela-river-la-a5d52c.png',
  'u9|Fieras LA FC': 'images/logos/teams/fieras-la-fc-c36cb6.png',
  'u9|LA Esperanza': 'images/logos/teams/la-esperanza-71f217.png',
  'u9|Los Selectos FC': 'images/logos/teams/los-selectos-fc-9558bd.png',
  'u9|South Central United FC': 'images/logos/teams/south-central-united-061160.png',
  'u9|Unamitas FC': 'images/logos/teams/unamitas-fc-155610.png',
  'u9|Wolfs FC': 'images/logos/teams/wolfs-fc-974a1b.png',
  'varonil|Boyle Heights FC': 'images/logos/teams/boyle-heights-01e2d4.png',
  'varonil|Callejeros FC': 'images/logos/teams/callejeros-fc-68f293.png',
  'varonil|City FC': 'images/logos/teams/city-fc-c0d49f.png',
  'varonil|Club Puebla LA': 'images/logos/teams/club-puebla-la-0008e1.png',
  'varonil|Hungover Boys': 'images/logos/teams/hungover-boys-fc-d76ba6.png',
  'varonil|Kairos FC': 'images/logos/teams/kairos-fc-6a2a9a.png',
  'varonil|La Familia FC': 'images/logos/teams/la-familia-4045ff.png',
  'varonil|Monarcas FC': 'images/logos/teams/monarcas-ef07f5.png',
  'varonil|Mountain View FC': 'images/logos/teams/mountain-view-fc-ad651f.png',
  'varonil|Puebla': 'images/logos/teams/puebla-1ffde6.png',
  'varonil|Troncos FC': 'images/logos/teams/dep-troncos-f2eb38.png',
  'fwednesdays|Dena FC': 'images/logos/teams/dena-fc-1f74d5.png',
  'fwednesdays|Dep Integracion': 'images/logos/teams/dep-integracion-2c5b82.png',
  'fwednesdays|Los Angeles FC': 'images/logos/teams/los-angeles-fc-a19fe4.png',
  'fwednesdays|El Monte FC': 'images/logos/teams/el-monte-fc-af99e0.png',
  'fwednesdays|Guatemex': 'images/logos/teams/guatemex-20f8f2.png',
  'fwednesdays|A Town Ballas': 'images/logos/teams/a-town-ballas-9584e9.png',
  'fwednesdays|Tuzos': 'images/logos/teams/tuzos-c69e9c.png',
  'fwednesdays|Dep Troncos': 'images/logos/teams/dep-troncos-f2eb38.png',
  'fwednesdays|The Gallery LA': 'images/logos/teams/the-gallery-la-66cfa8.png',
  'fwednesdays|Irvine FC Academy': 'images/logos/teams/irvine-fc-academy-db97eb.png',
  'fwednesdays|Napoli': 'images/logos/teams/napoli-f3e5a6.png',
  'fwednesdays|Mountain View FC': 'images/logos/teams/mountain-view-fc-ad651f.png',
  'fwednesdays|Burger Boys': 'images/logos/teams/burger-boys-439763.png',
  'fthursdays|Polanco 24': 'images/logos/teams/polanco-24-6e997b.png',
  'fthursdays|Camoteros FC': 'images/logos/teams/puebla-1ffde6.png',
  'fthursdays|KenNedy FC': 'images/logos/teams/kennedy-fc-b9d014.png',
  'fthursdays|Carnales FC': 'images/logos/teams/carnales-fc-c430c6.png',
  'fthursdays|Piratas FC': 'images/logos/teams/piratas-fc-3301ff.png',
  'fthursdays|Barcelona': 'images/logos/teams/barcelona-9b4e48.png',
  'fthursdays|El Sereno SC': 'images/logos/teams/el-sereno-fc-8815c6.png',
};

// Registration links (Google Forms and documents), moved over from laalhambrasoccer.com/register.
const REGISTRATION = {
  googleTutorial: 'https://www.youtube.com/watch?v=XIwreUawWiE',
  googleSignup: 'https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp',
  contractEn: 'https://drive.google.com/file/d/1MnsjQd9LsB9YOEzSd4BIhj2iA9HD-QwK/view?usp=drive_link',
  contractEs: 'https://drive.google.com/file/d/1kj40Q1RcLb9VpW0GukwHGEusp1LnJadQ/view?usp=drive_link',
  coaches: 'https://docs.google.com/forms/d/e/1FAIpQLSemDAflCWxpRMq8E5m_MfrO0zhqUlEs5G3vc4k7E48trJFnjA/viewform',
  // Youth age chart: game format, and the one-year-older birth year girls can also play in.
  ageChart: {
    u5: ['6 v 6', '2020'], u7: ['7 v 7', '2019'], u9: ['9 v 9', '2017'], u11: ['11 v 11', '2015'],
    u13: ['11 v 11', '2013'], u15: ['11 v 11', '2011'], u17: ['11 v 11', '2009'], u19: ['11 v 11', ''],
  },
  forms: {
    u19: ['2008/2009', 'https://docs.google.com/forms/d/e/1FAIpQLScxZWUhcAeL7CF4VFPGx1WQCXJR0tAknEl7g4DNY70dfSlfrA/viewform'],
    u17: ['2010/2011', 'https://docs.google.com/forms/d/e/1FAIpQLSeqAYZLuPEMw-Ddw0qpTuR04XLKe8x7kOPyA167pWVo2P85qQ/viewform'],
    u15: ['2012/2013', 'https://docs.google.com/forms/d/e/1FAIpQLSdCzvkBZkTfdrCdH8LgK3_MKkGL6rALmbL3t7Gg4bg-t62Hzw/viewform'],
    u13: ['2014/2015', 'https://docs.google.com/forms/d/e/1FAIpQLScw-WT6qhRk9-bDHYBkCCyGCKojwW6RafuGcngu-gIIKgdn-w/viewform'],
    u11: ['2016/2017', 'https://docs.google.com/forms/d/e/1FAIpQLSeNDXviPTT097bqD0rd4Bfb9AZA2HtdL-byt6Uk38Px6YVDGg/viewform'],
    u9: ['2018/2019', 'https://docs.google.com/forms/d/e/1FAIpQLSeDLuptzO0s5cYGt5uG1JrbBlECeo6NT-_1DdXcXLWSr4-7-w/viewform'],
    u7: ['2020/2021', 'https://docs.google.com/forms/d/e/1FAIpQLSct_2nk3pfywfMf2tadFy-U1IDeI9irOstXVsx2EKvccMOmAQ/viewform'],
    u5: ['2021–2023', 'https://docs.google.com/forms/d/e/1FAIpQLSeEdz9AbQuqjjki6Sa51sOULQl81sImoV5JSV9t0VVLNvKanQ/viewform'],
    varonil: ['18+', 'https://docs.google.com/forms/d/e/1FAIpQLScGbYLikLl97ksoqBZFDtqRdh4Z8s6smAtC3IUJvErX5I4_QQ/viewform'],
    '40': ['', 'https://docs.google.com/forms/d/e/1FAIpQLSdPMtmhDoydO5lNDSItdScSD2I_MS4KROxDbuuyVVnMtfyt6w/viewform'],
    femenil: ['18+', 'https://docs.google.com/forms/d/e/1FAIpQLSeb496SnH0pF9L2dqXLv71rGQXRlC8NvK3fvksDwm-6OCHW1g/viewform'],
    fthursdays: ['', 'https://docs.google.com/forms/d/e/1FAIpQLScTFnTMwYdGvw3lApPrPYfUir5OrOg6UIreD5e1TCzKa3NPGw/viewform'],
  },
};

const RESULTS = {
  '40': `
08/26/2026|2:15PM|Bitely ES - Field 3|Wolfs FC|Dep Miramar|0 - 6
08/26/2026|3:00PM|El Sereno Park - Field #1|Colima FC|C.D. Ajax|6 - 2
08/26/2026|3:30PM|Bitely ES - Field 3|Manchester United|Francisquense FC|3 - 3
08/26/2026|3:30PM|Bitely ES - Field 1|Rebano Tuzo|LA City|3 - 3
08/26/2026|4:45PM|Bitely ES - Field 1|Nazareno FC|Monarcas|6 - 2
08/26/2026|4:45PM|Bitely ES - Field 3|Barcelona|Atlante|2 - 6
08/26/2026|6:00PM|Bitely ES - Field 3|Ixtac|Bufalos|2 - 5
08/30/2026|2:30PM|El Sereno Park - Field #1|Atlante|Nazareno FC|2 - 3
08/30/2026|3:30PM|Bitely ES - Field 1|Monarcas|Rebano Tuzo|3 - 2
08/30/2026|3:30PM|Bitely ES - Field 3|Unamitas FC|Manchester United|4 - 2
08/30/2026|3:30PM|El Sereno Park - Field #1|Francisquense FC|Ixtac|0 - 2
08/30/2026|4:30PM|Bitely ES - Field 1|Bufalos|Colima FC|1 - 4
08/30/2026|4:30PM|Bitely ES - Field 3|Dep Miramar|Barcelona|3 - 1
08/30/2026|5:30PM|Bitely ES - Field 3|C.D. Ajax|Wolfs FC|0 - 3
09/13/2026|3:30PM|Bitely ES - Field 3|Unamitas FC|LA City|0 - 3
09/13/2026|3:30PM|El Sereno Park - Field #1|Colima FC|Francisquense FC|3 - 1
09/13/2026|3:30PM|Bitely ES - Field 1|Nazareno FC|Dep Miramar|2 - 1
09/13/2026|4:30PM|El Sereno Park - Field #1|Manchester United|Ixtac|4 - 1
09/13/2026|4:30PM|Bitely ES - Field 3|Wolfs FC|Bufalos|2 - 1
09/13/2026|4:30PM|Bitely ES - Field 1|Rebano Tuzo|Atlante|4 - 5
09/13/2026|5:30PM|Bitely ES - Field 3|Barcelona|C.D. Ajax|2 - 1
09/20/2026|2:30PM|El Sereno Park - Field #1|Ixtac|Colima FC|0 - 3
09/20/2026|2:30PM|Bitely ES - Field 3|Francisquense FC|New Team|3 - 0
09/20/2026|3:30PM|Bitely ES - Field 3|Bufalos|Barcelona|5 - 3
09/20/2026|3:30PM|Bitely ES - Field 1|Dep Miramar|Rebano Tuzo|5 - 3
09/20/2026|3:30PM|El Sereno Park - Field #1|Monarcas|Atlante|1 - 1
09/20/2026|4:30PM|Bitely ES - Field 3|C.D. Ajax|Nazareno FC|1 - 8
09/20/2026|4:30PM|Bitely ES - Field 1|LA City|Manchester United|1 - 3
09/27/2026|2:30PM|El Sereno Park - Field #1|Dep Miramar|Atlante|1 - 3
09/27/2026|2:30PM|Bitely ES - Field 3|Nazareno FC|Bufalos|1 - 0
09/27/2026|3:30PM|Bitely ES - Field 1|Rebano Tuzo|C.D. Ajax|4 - 2
09/27/2026|3:30PM|El Sereno Park - Field #1|Barcelona|Francisquense FC|3 - 2
09/27/2026|3:30PM|Bitely ES - Field 3|LA City|Monarcas|1 - 2
09/27/2026|4:30PM|Bitely ES - Field 1|Wolfs FC|Ixtac|1 - 14
09/27/2026|4:30PM|Bitely ES - Field 3|Manchester United|Colima FC|0 - 4
10/04/2026|2:30PM|Bitely ES - Field 1|Monarcas|Manchester United|2 - 4
10/04/2026|2:30PM|Bitely ES - Field 3|Dep Miramar|C.D. Ajax|7 - 1
10/04/2026|2:30PM|El Sereno Park - Field #1|Francisquense FC|Nazareno FC|1 - 5
10/04/2026|3:30PM|Bitely ES - Field 1|Bufalos|Rebano Tuzo|1 - 3
10/04/2026|3:30PM|El Sereno Park - Field #1|Colima FC|Wolfs FC|3 - 0
10/04/2026|3:30PM|Bitely ES - Field 3|Ixtac|Barcelona|3 - 2
10/04/2026|4:30PM|Bitely ES - Field 3|Atlante|LA City|3 - 1
10/11/2026|2:00PM|Bitely ES - Field 3|Monarcas|Atlante|2 - 3
10/11/2026|2:30PM|Bitely ES - Field 1|Nazareno FC|Ixtac|6 - 5
10/11/2026|3:00PM|Bitely ES - Field 3|Bufalos|C.D. Ajax|4 - 1
10/11/2026|3:30PM|El Sereno Park - Field #1|Rebano Tuzo|Francisquense FC|8 - 1
10/11/2026|3:30PM|Bitely ES - Field 1|Manchester United|Wolfs FC|2 - 2
10/11/2026|4:00PM|Bitely ES - Field 3|Barcelona|Colima FC|0 - 5
10/11/2026|4:30PM|El Sereno Park - Field #1|LA City|Dep Miramar|2 - 0
10/18/2026|2:30PM|El Sereno Park - Field #1|Bufalos|Francisquense FC|5 - 3
10/18/2026|2:30PM|Bitely ES - Field 3|Atlante|Manchester United|6 - 1
10/18/2026|3:30PM|Bitely ES - Field 1|Dep Miramar|Monarcas|6 - 2
10/18/2026|3:30PM|Bitely ES - Field 3|C.D. Ajax|LA City|1 - 3
10/18/2026|4:30PM|El Sereno Park - Field #1|Ixtac|Rebano Tuzo|2 - 2
10/18/2026|4:30PM|Bitely ES - Field 1|Colima FC|Nazareno FC|0 - 3
10/18/2026|4:30PM|Bitely ES - Field 3|Wolfs FC|Barcelona|6 - 1
10/25/2026|2:30PM|Bitely ES - Field 3|Atlante|Francisquense FC|5 - 1
10/25/2026|2:30PM|Bitely ES - Field 1|Dep Miramar|Ixtac|2 - 0
10/25/2026|3:30PM|Bitely ES - Field 3|Manchester United|Barcelona|8 - 0
10/25/2026|3:30PM|Bitely ES - Field 1|Rebano Tuzo|Colima FC|4 - 2
10/25/2026|3:30PM|El Sereno Park - Field #1|Nazareno FC|Wolfs FC|0 - 0
10/25/2026|4:30PM|Bitely ES - Field 3|Monarcas|C.D. Ajax|1 - 0
10/25/2026|4:30PM|Bitely ES - Field 1|LA City|Bufalos|0 - 2
`,
  femenil: `
09/13/2026|2:30PM - 3:30PM|Bitely ES - Field 2|Acapulco SC|Unamitas FC|0 - 12
09/13/2026|3:30PM - 4:30PM|Bitely ES - Field 2|Lady Angels|LAFC7|1 - 2
09/13/2026|4:30PM - 5:30PM|Bitely ES - Field 2|Guerreras FC|Aztecas FC|0 - 4
09/13/2026|5:30PM - 6:30PM|Bitely ES - Field 2|Girls Game LA|Las Damas de LC|4 - 1
09/20/2026|2:30PM - 3:30PM|Bitely ES - Field 2|Unamitas FC|Guerreras FC|0 - 3
09/20/2026|3:30PM - 4:30PM|Bitely ES - Field 2|LAFC7|Acapulco SC|8 - 0
09/20/2026|4:30PM - 5:30PM|Bitely ES - Field 2|Las Damas de LC|Lady Angels|1 - 0
09/20/2026|5:30PM - 6:30PM|Bitely ES - Field 2|Aztecas FC|Girls Game LA|0 - 2
09/27/2026|2:30PM - 3:30PM|Bitely ES - Field 2|Aztecas FC|Unamitas FC|12 - 0
09/27/2026|3:00PM - 4:00PM|El Sereno Park - Field #2|Acapulco SC|Las Damas de LC|0 - 10
09/27/2026|3:30PM - 4:30PM|Bitely ES - Field 2|Girls Game LA|Lady Angels|6 - 0
09/27/2026|4:00PM - 5:00PM|El Sereno Park - Field #2|Guerreras FC|LAFC7|3 - 0
10/04/2026|2:00PM - 3:00PM|El Sereno Park - Field #2|LAFC7|Aztecas FC|0 - 4
10/04/2026|2:00PM - 3:00PM|Bitely ES - Field 2|Unamitas FC|Girls Game LA|1 - 4
10/04/2026|3:00PM - 4:00PM|El Sereno Park - Field #2|Las Damas de LC|Guerreras FC|0 - 4
10/04/2026|4:00PM - 5:00PM|Bitely ES - Field 2|Lady Angels|Acapulco SC|1 - 1
10/11/2026|2:00PM - 3:00PM|Bitely ES - Field 2|Unamitas FC|LAFC7|0 - 3
10/11/2026|2:30PM - 3:30PM|El Sereno Park - Field #2|Guerreras FC|Lady Angels|7 - 0
10/11/2026|3:00PM - 4:00PM|Bitely ES - Field 2|Girls Game LA|Acapulco SC|10 - 1
10/11/2026|3:30PM - 4:30PM|El Sereno Park - Field #2|Aztecas FC|Las Damas de LC|0 - 1
10/18/2026|2:30PM - 3:30PM|Bitely ES - Field 2|Acapulco SC|Guerreras FC|0 - 7
10/18/2026|2:30PM - 3:30PM|El Sereno Park - Field #2|Lady Angels|Aztecas FC|0 - 9
10/18/2026|3:30PM - 4:30PM|Bitely ES - Field 2|LAFC7|Girls Game LA|1 - 0
10/18/2026|3:30PM - 4:30PM|El Sereno Park - Field #2|Las Damas de LC|Dep Samayoa FC|3 - 0
10/25/2026|2:00PM - 3:00PM|El Sereno Park - Field #2|Aztecas FC|Acapulco SC|2 - 0
10/25/2026|2:00PM - 3:00PM|Bitely ES - Field 2|Dep Samayoa FC|Lady Angels|0 - 3
10/25/2026|3:00PM - 4:00PM|El Sereno Park - Field #2|Girls Game LA|Guerreras FC|0 - 2
10/25/2026|3:00PM - 4:00PM|Bitely ES - Field 2|LAFC7|Las Damas de LC|1 - 1
`,
  varonil: `
10/18/2026|2:00PM - 3:15PM|Rio de Los Angeles State Park - Field 1|Monarcas FC|Troncos FC|2 - 2
10/18/2026|3:15PM - 4:30PM|Rio de Los Angeles State Park - Field 1|Kairos FC|Hungover Boys|0 - 3
10/18/2026|4:30PM - 5:45PM|Rio de Los Angeles State Park - Field 1|Puebla|Club Puebla LA|0 - 3
10/18/2026|5:45PM - 7:00PM|Rio de Los Angeles State Park - Field 1|Mountain View FC|Callejeros FC|6 - 1
10/18/2026|7:00PM - 8:15PM|Rio de Los Angeles State Park - Field 1|Boyle Heights FC|City FC|0 - 8
10/25/2026|2:00PM - 3:15PM|Rio de Los Angeles State Park - Field 1|Troncos FC|Puebla|2 - 1
10/25/2026|3:15PM - 4:30PM|Rio de Los Angeles State Park - Field 1|Hungover Boys|Monarcas FC|4 - 1
10/25/2026|4:30PM - 5:45PM|Rio de Los Angeles State Park - Field 1|NELA FC|Mountain View FC|0 - 3
10/25/2026|4:45PM - 6:00PM|El Sereno Park - Field #1|Club Puebla LA|La Familia FC|5 - 2
10/25/2026|5:45PM - 7:00PM|Rio de Los Angeles State Park - Field 1|City FC|Kairos FC|6 - 1
10/25/2026|7:15PM - 8:30PM|Rio de Los Angeles State Park - Field 1|Callejeros FC|Boyle Heights FC|1 - 1
`,
  u5: `
10/18/2026|11:00AM - 11:45AM|Bitely ES - Field 4|Unamitas FC U-5|Alhambra United U-5|3 - 3
10/18/2026|11:45AM - 12:30PM|Bitely ES - Field 4|Los Selectos FC U-5|Unamitas Elite U-5|2 - 0
10/25/2026|8:45AM - 9:30AM|Bitely ES - Field 4|Unamitas Elite U-5|Alhambra United U-5|0 - 3
10/25/2026|9:45AM - 10:30AM|Bitely ES - Field 4|Unamitas FC U-5|Los Selectos FC U-5|0 - 1
`,
  u7: `
10/18/2026|8:00AM - 9:00AM|Bitely ES - Field 4|Force FC U-7|Unamitas Elite U-7|5 - 0
10/18/2026|9:00AM - 10:00AM|Bitely ES - Field 4|Unamitas FC U-7|Alhambra United U-7|4 - 1
10/18/2026|10:00AM - 11:00AM|Bitely ES - Field 4|New Team U-7|Leon FC U-7|0 - 3
10/18/2026|12:30PM - 1:30PM|Bitely ES - Field 4|Fieras LA FC U-7|Los Selectos FC U-7|0 - 6
10/25/2026|8:00AM - 8:45AM|Bitely ES - Field 4|Alhambra United U-7|Force FC U-7|0 - 2
10/25/2026|10:30AM - 11:30AM|Bitely ES - Field 4|Los Selectos FC U-7|Unamitas FC U-7|1 - 1
10/25/2026|11:30AM - 12:30PM|Bitely ES - Field 4|Leon FC U-7|Fieras LA FC U-7|1 - 2
10/25/2026|12:30PM - 1:30PM|Bitely ES - Field 4|Unamitas Elite U-7|Little Monster SC U-7|2 - 1
`,
  u9: `
10/18/2026|8:00AM - 9:00AM|Bitely ES - Field 2|LA Esperanza U-9|Unamitas Premier U-9|24 - 0
10/18/2026|9:00AM - 10:00AM|Bitely ES - Field 2|Fieras LA FC U-9|Unamitas Elite U-9|1 - 4
10/18/2026|10:00AM - 11:00AM|Bitely ES - Field 2|Unamitas FC U-9|Alhambra FC U-9|4 - 5
10/18/2026|11:00AM - 12:00PM|Bitely ES - Field 2|Alhambra United U-9|Los Selectos FC U-9|15 - 0
10/18/2026|12:00PM - 1:00PM|Bitely ES - Field 2|South Central United FC U-9|Wolfs FC U-9|7 - 0
10/25/2026|8:00AM - 9:15AM|Bitely ES - Field 2|Escuela River U-9|Alhambra United U-9|1 - 11
10/25/2026|9:15AM - 10:30AM|El Sereno Park - Field #2|Wolfs FC U-9|Los Selectos FC U-9|0 - 6
10/25/2026|9:15AM - 10:30AM|Bitely ES - Field 2|Alhambra FC U-9|LA Esperanza U-9|2 - 8
10/25/2026|10:30AM - 11:45AM|Bitely ES - Field 2|Unamitas Premier U-9|Fieras LA FC U-9|0 - 4
10/25/2026|11:45AM - 1:00PM|Bitely ES - Field 2|Unamitas Elite U-9|South Central United FC U-9|1 - 5
`,
  u11: `
10/18/2026|8:00AM - 9:15AM|Bitely ES - Field 3|Unamitas FC U-11|Alhambra FC U-11|0 - 9
10/18/2026|9:15AM - 10:30AM|Bitely ES - Field 3|EMC FC U-11|Los Selectos FC U-11|0 - 30
10/18/2026|10:30AM - 11:45AM|Rio de Los Angeles State Park - Field 2|Fenix LA U-11|Jrs FC U-11|6 - 4
10/18/2026|10:30AM - 11:45AM|Bitely ES - Field 3|Fieras LA FC U-11|Unamitas Elite U-11|10 - 0
10/18/2026|11:45AM - 1:00PM|Guardia Park - Field #1|Barcelona U-11|Angelinos FC U-11|16 - 0
10/18/2026|11:45AM - 1:00PM|Bitely ES - Field 3|Titans United FC U-11|Wolfs FC U-11|8 - 0
10/18/2026|1:00PM - 2:15PM|Bitely ES - Field 3|LA Alhambra U-11|LA Juve U-11|2 - 1
10/25/2026|8:00AM - 9:15AM|Bitely ES - Field 3|Los Selectos FC U-11|Unamitas FC U-11|5 - 0
10/25/2026|9:15AM - 10:30AM|Bitely ES - Field 3|Escuela River U11|LA Alhambra U-11|4 - 0
10/25/2026|10:30AM - 11:45AM|El Sereno Park - Field #2|LA Juve U-11|Barcelona U-11|0 - 9
10/25/2026|10:30AM - 11:45AM|Bitely ES - Field 3|Unamitas Elite U-11|South Central United FC U-11|0 - 9
10/25/2026|10:30AM - 11:45AM|Guardia Park - Field #1|Alhambra FC U-11|Fenix LA U-11|8 - 3
10/25/2026|10:30AM - 11:45AM|Rio de Los Angeles State Park - Field 2|Jrs FC U-11|Titans United FC U-11|1 - 17
10/25/2026|11:45AM - 1:00PM|Bitely ES - Field 3|Inter Milan U-11|Fieras LA FC U-11|1 - 5
10/25/2026|11:45AM - 1:00PM|El Sereno Park - Field #2|Wolfs FC U-11|EMC FC U-11|15 - 0
10/25/2026|1:00PM - 2:15PM|Bitely ES - Field 3|Angelinos FC U-11|New Team U-11|1 - 4
`,
  u13: `
10/18/2026|8:00AM - 9:15AM|Bitely ES - Field 1|Flamenco FC U-13|Unamitas Elite U-13|20 - 0
10/18/2026|8:00AM - 9:15AM|El Sereno Park - Field #1|Union FC U-13|Wolfs FC U-13|3 - 7
10/18/2026|9:15AM - 10:30AM|Franklin HS - Field 1|Fenix LA U-13|Pumas Academy U-13|1 - 2
10/18/2026|10:30AM - 11:45AM|Bitely ES - Field 1|LA Masia U-11 U-13|Los Selectos FC U-13|7 - 0
10/18/2026|10:30AM - 11:45AM|Franklin HS - Field 1|Aguilitas U-13|LA Esperanza U-13|1 - 10
10/18/2026|10:30AM - 11:45AM|Guardia Park - Field #1|Barcelona U-13|Angelinos FC U-13|6 - 0
10/18/2026|11:45AM - 1:00PM|Bitely ES - Field 1|Unamitas FC U-13|Alhambra FC U-13|5 - 1
10/18/2026|2:15PM - 3:30PM|Bitely ES - Field 1|Inter Milan U-13|LA Juve U-13|1 - 11
10/25/2026|8:00AM - 9:15AM|Franklin HS - Field 1|Angelinos FC U-13|Flamenco FC U-13|1 - 10
10/25/2026|8:00AM - 9:15AM|Guardia Park - Field #1|Pumas Academy U-13|Titans United FC U-13|7 - 1
10/25/2026|9:15AM - 10:30AM|El Sereno Park - Field #1|LA Juve U-13|Barcelona U-13|0 - 6
10/25/2026|9:15AM - 10:30AM|Bitely ES - Field 1|Escuela River U-13|Aguilitas U-13|7 - 1
10/25/2026|10:30AM - 11:45AM|Bitely ES - Field 1|Los Selectos FC U-13|Unamitas FC U-13|2 - 3
10/25/2026|11:45AM - 1:00PM|Guardia Park - Field #1|Alhambra FC U-13|Fenix LA U-13|2 - 2
10/25/2026|1:00PM - 2:15PM|El Sereno Park - Field #1|Wolfs FC U-13|LA Esperanza U-13|3 - 2
10/25/2026|1:00PM - 2:15PM|Bitely ES - Field 1|Unamitas Elite U-13|Union FC U-13|0 - 8
`,
  u15: `
10/18/2026|8:00AM - 9:15AM|Franklin HS - Field 1|FC Boyle Heights U-15|Pumas Academy U-15|1 - 1
10/18/2026|9:15AM - 10:30AM|Bitely ES - Field 1|Flamenco FC U-15|Santa Cruz Thunder U-15|2 - 1
10/18/2026|9:15AM - 10:30AM|Guardia Park - Field #1|Fieras LA FC U-15|Angelinos FC U-15|2 - 0
10/18/2026|9:15AM - 10:30AM|El Sereno Park - Field #1|Atletico Morelia U-15|Wolfs FC U-15|0 - 9
10/18/2026|11:45AM - 1:00PM|Franklin HS - Field 1|Aguilitas B U-15|LA Esperanza U-15|1 - 4
10/18/2026|1:00PM - 2:15PM|Bitely ES - Field 1|Unamitas FC U-15|Alhambra FC U-15|0 - 2
10/18/2026|1:00PM - 2:15PM|Guardia Park - Field #1|New Team U-15A|Legacy XI U-15|0 - 3
10/18/2026|1:00PM - 2:15PM|Franklin HS - Field 1|LA Juniors U-15|Aguilitas A U-15|8 - 3
10/18/2026|2:15PM - 3:30PM|Franklin HS - Field 1|EMC FC U-15|Invictus FC U15|1 - 4
10/25/2026|8:00AM - 9:15AM|Bitely ES - Field 1|Escuela River U-15|Aguilitas B U-15|12 - 1
10/25/2026|8:00AM - 9:15AM|El Sereno Park - Field #1|Invictus FC U15|Fieras LA FC U-15|0 - 3
10/25/2026|9:15AM - 10:30AM|Franklin HS - Field 1|Angelinos FC U-15|Flamenco FC U-15|2 - 2
10/25/2026|9:15AM - 10:30AM|Guardia Park - Field #1|Pumas Academy U-15|EMC FC U-15|7 - 1
10/25/2026|10:30AM - 11:45AM|Franklin HS - Field 1|LA Esperanza U-15|Legacy XI U-15|4 - 2
10/25/2026|11:45AM - 1:00PM|Bitely ES - Field 1|Aguilitas A U-15|Unamitas FC U-15|0 - 3
10/25/2026|1:00PM - 2:15PM|Guardia Park - Field #1|Alhambra FC U-15|FC Boyle Heights U-15|1 - 5
10/25/2026|2:15PM - 3:30PM|Franklin HS - Field 1|Santa Cruz Thunder U-15|Atletico Morelia U-15|2 - 0
10/25/2026|2:15PM - 3:30PM|El Sereno Park - Field #1|Wolfs FC U-15|LA Juniors U-15|2 - 4
`,
  u17: `
10/18/2026|8:00AM - 9:15AM|Guardia Park - Field #1|Fieras LA FC U-17|Real Azul FC U-17|0 - 0
10/18/2026|8:00AM - 9:15AM|Contreras HS - Field #1|LA City U-17|Santos FC U-17|0 - 2
10/18/2026|10:30AM - 11:45AM|Contreras HS - Field #1|FC Portugal U-17|LA Juve U-17|3 - 2
10/18/2026|11:45AM - 1:00PM|El Sereno Park - Field #1|Universitario Nacional U-17|Atletico Morelia U-17|0 - 3
10/18/2026|1:00PM - 2:15PM|Contreras HS - Field #1|Galaxy U-17|Barcelona U-17|0 - 5
10/25/2026|10:30AM - 11:45AM|Contreras HS - Field #1|Santos FC U-17|Fieras LA FC U-17|2 - 1
10/25/2026|11:45AM - 1:00PM|Contreras HS - Field #1|Real Azul FC U-17|FC Portugal U-17|1 - 2
10/25/2026|11:45AM - 1:00PM|El Sereno Park - Field #1|LA Juve U-17|Universitario Nacional U-17|2 - 1
10/25/2026|11:45AM - 1:00PM|Franklin HS - Field 1|Atletico Morelia U-17|Galaxy U-17|3 - 0
10/25/2026|1:00PM - 2:15PM|Contreras HS - Field #1|Barcelona U-17|LA City U-17|6 - 1
`,
  u19: `
10/18/2026|9:15AM - 10:30AM|Contreras HS - Field #1|LA City U-19|Santos FC U-19|1 - 1
10/18/2026|10:30AM - 11:45AM|El Sereno Park - Field #1|Universitario Nacional U-19|Atletico Morelia U-19|0 - 0
10/18/2026|11:45AM - 1:00PM|Contreras HS - Field #1|Humildes FC U-19|Atletico FC U-19|5 - 3
10/18/2026|1:00PM - 2:15PM|El Sereno Park - Field #1|Francisquense FC U-19|Cracks FC U-19|0 - 3
10/18/2026|2:15PM - 3:30PM|Contreras HS - Field #1|MC FC U-19|Lobos FC U-19|0 - 3
10/25/2026|8:00AM - 9:15AM|Contreras HS - Field #1|Atletico FC U-19|Francisquense FC U-19|2 - 2
10/25/2026|9:15AM - 10:30AM|Contreras HS - Field #1|Santos FC U-19|Humildes FC U-19|2 - 1
10/25/2026|10:30AM - 11:45AM|El Sereno Park - Field #1|LA Juve U-19|Universitario Nacional U-19|1 - 2
10/25/2026|1:00PM - 2:15PM|Franklin HS - Field 1|Atletico Morelia U-19|Cracks FC U-19|1 - 2
10/25/2026|2:15PM - 3:30PM|Contreras HS - Field #1|Lobos FC U-19|LA City U-19|0 - 3
`,
  fwednesdays: `
10/28/2026|7:00PM - 7:45PM|El Sereno Park - Field #1|Dena FC|Tuzos|2 - 12
10/28/2026|7:45PM - 8:30PM|El Sereno Park - Field #1|The Gallery LA|Napoli|12 - 4
10/28/2026|7:45PM - 8:30PM|El Sereno Park - Field #2|Irvine FC Academy|Dep Integracion|4 - 3
10/28/2026|8:30PM - 9:15PM|El Sereno Park - Field #2|El Monte FC|Los Angeles FC|0 - 8
10/28/2026|8:30PM - 9:15PM|El Sereno Park - Field #1|Burger Boys|Mountain View FC|9 - 3
10/28/2026|9:15PM - 10:00PM|El Sereno Park - Field #2|A Town Ballas|Dep Troncos|8 - 2
10/28/2026|9:15PM - 10:00PM|El Sereno Park - Field #1|QFC|Guatemex|2 - 3
`,
  fthursdays: `
09/12/2026|8:15AM - 9:00AM|El Sereno Park - Field #1|Piratas FC|Polanco 24|2 - 2
09/12/2026|8:15AM - 9:00AM|El Sereno Park - Field #2|Camoteros FC|Barcelona|2 - 8
09/12/2026|9:00AM - 9:45AM|El Sereno Park - Field #1|Carnales FC|El Sereno SC|6 - 8
09/12/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|El Sereno SC|Camoteros FC|13 - 1
09/12/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Barcelona|Piratas FC|4 - 2
09/12/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Polanco 24|Carnales FC|13 - 2
09/17/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|Barcelona|El Sereno SC|6 - 1
09/17/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Camoteros FC|Polanco 24|6 - 11
09/17/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Piratas FC|Carnales FC|14 - 10
09/24/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|El Sereno SC|Piratas FC|5 - 8
09/24/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Carnales FC|Camoteros FC|9 - 4
09/24/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Polanco 24|Barcelona|6 - 6
10/01/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|El Sereno SC|Polanco 24|4 - 10
10/01/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Barcelona|New Team|15 - 2
10/01/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Piratas FC|Camoteros FC|10 - 2
10/08/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|Polanco 24|Piratas FC|5 - 8
10/08/2026|8:15PM - 9:00PM|El Sereno Park - Field #2|El Sereno SC|Carnales FC|7 - 5
10/08/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|New Team|KenNedy FC|3 - 7
10/08/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Barcelona|Camoteros FC|17 - 0
10/15/2026|8:15PM - 9:00PM|El Sereno Park - Field #2|Camoteros FC|New Team|10 - 6
10/15/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|El Sereno SC|KenNedy FC|5 - 7
10/15/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Carnales FC|Polanco 24|6 - 7
10/15/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Piratas FC|Barcelona|6 - 9
10/22/2026|8:15PM - 9:00PM|El Sereno Park - Field #2|Barcelona|New Team|11 - 0
10/22/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|Carnales FC|Piratas FC|19 - 6
10/22/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|El Sereno SC|Camoteros FC|6 - 2
10/22/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Polanco 24|KenNedy FC|10 - 9
10/29/2026|8:15PM - 9:00PM|El Sereno Park - Field #1|KenNedy FC|Carnales FC|7 - 6
10/29/2026|8:15PM - 9:00PM|El Sereno Park - Field #2|Piratas FC|New Team|7 - 3
10/29/2026|9:00PM - 9:45PM|El Sereno Park - Field #2|Camoteros FC|Polanco 24|4 - 10
10/29/2026|9:00PM - 9:45PM|El Sereno Park - Field #1|Barcelona|El Sereno SC|6 - 3
`,
};

// Goleadores from the league's Goleadores sheet (Nov 4, 2026): [division, player, team, goals in each of
// the team's games (G1 = its first game), own goals/default row].
const SEED_SCORERS = [
  ['varonil', 'Alejandro Centeno', 'Boyle Heights FC', [0, 1]],
  ['varonil', 'Alex', 'Callejeros FC', [0, 1]],
  ['varonil', 'Jeffry Luarca', 'City FC', [3, 1]],
  ['varonil', 'Lance Luarca', 'City FC', [1]],
  ['varonil', 'Zaudiel Cardenas', 'City FC', [1]],
  ['varonil', 'Darven Barchiona', 'City FC', [2, 1]],
  ['varonil', 'Eden Beltran', 'City FC', [1, 1]],
  ['varonil', 'Brandon Gamboa', 'City FC', [0, 1]],
  ['varonil', 'Alexis Pineda', 'Club Puebla LA', [2]],
  ['varonil', 'Jairo Alvarado', 'Club Puebla LA', [1]],
  ['varonil', 'Henry Barrientos', 'Club Puebla LA', [0, 3]],
  ['varonil', 'Edelmir Trigo', 'Club Puebla LA', [0, 1]],
  ['varonil', 'Justin Nushimoto', 'Club Puebla LA', [0, 1]],
  ['varonil', 'James Baker', 'Hungover Boys', [0, 1]],
  ['varonil', 'Kobe Silva', 'Hungover Boys', [0, 1]],
  ['varonil', 'Eduardo Sanchez', 'Hungover Boys', [0, 1]],
  ['varonil', 'Christian Villegas', 'Hungover Boys', [0, 1]],
  ['varonil', 'DEFAULT/AUTOGOAL', 'Hungover Boys', [3], true],
  ['varonil', 'Zack Zamora', 'Kairos FC', [0, 1]],
  ['varonil', 'Ivan De La Torre', 'La Familia FC', [1]],
  ['varonil', 'Osvaldo Espinosa', 'La Familia FC', [1]],
  ['varonil', 'Adolfo Rojas', 'Monarcas FC', [1]],
  ['varonil', 'Emilio Olmos', 'Monarcas FC', [1]],
  ['varonil', 'Jason Marin', 'Monarcas FC', [0, 1]],
  ['varonil', 'Nelson Amador', 'Mountain View FC', [4]],
  ['varonil', 'Edgar Nunes', 'Mountain View FC', [1]],
  ['varonil', 'Sergio Pineda', 'Mountain View FC', [1]],
  ['varonil', 'Miguel Villanueva', 'NELA FC', []],
  ['varonil', 'Geovany Huerta', 'NELA FC', []],
  ['varonil', 'Jeison Rodas', 'NELA FC', []],
  ['varonil', 'Juan Minoz', 'Puebla', [0, 1]],
  ['varonil', 'Michael Galvez', 'Troncos FC', [1]],
  ['varonil', 'Alex Jimenez', 'Troncos FC', [1]],
  ['varonil', 'Jose Perez', 'Troncos FC', [0, 1]],
  ['varonil', 'Marvin Gonzalez', 'Troncos FC', [0, 1]],
  ['femenil', 'Vency Tobar', 'Acapulco SC', [0, 0, 0, 1, 1]],
  ['femenil', 'Genessis Rendon', 'Aztecas FC', [3, 0, 1, 0, 0, 2]],
  ['femenil', 'Maria Rodriguez', 'Aztecas FC', [1, 0, 0, 2]],
  ['femenil', 'Maria Opez', 'Aztecas FC', [0, 0, 1]],
  ['femenil', 'Nurca Donet', 'Aztecas FC', [0, 0, 2, 1, 0, 2]],
  ['femenil', 'Jaie Mejia', 'Aztecas FC', [0, 0, 2]],
  ['femenil', 'Prisila Cruz', 'Aztecas FC', [0, 0, 6, 1, 0, 3, 1]],
  ['femenil', 'Niurka', 'Aztecas FC', [0, 0, 0, 0, 0, 1]],
  ['femenil', 'Marielos Temes', 'Aztecas FC', [0, 0, 0, 0, 0, 1]],
  ['femenil', 'Luz Vargas', 'Aztecas FC', [0, 0, 0, 0, 0, 0, 1]],
  ['femenil', 'Vanessa Aldana', 'Guerreras FC', [0, 0, 1, 1, 1, 3]],
  ['femenil', 'Alejadra Garcia', 'Guerreras FC', [0, 1, 1, 2, 2, 4, 2]],
  ['femenil', 'Kimberli Carlos', 'Guerreras FC', [0, 0, 1, 0, 1]],
  ['femenil', 'Karla Castellanos', 'Guerreras FC', [0, 2, 0, 1, 1]],
  ['femenil', 'Angelica Hidalgo', 'Guerreras FC', [0, 0, 0, 0, 1]],
  ['femenil', 'Anel Gonzalez', 'Guerreras FC', [0, 0, 0, 0, 1]],
  ['femenil', 'Rosario Ahumada', 'Girls Game LA', [3, 1, 2, 3, 4]],
  ['femenil', 'Yanei Palma', 'Girls Game LA', [1]],
  ['femenil', 'Sanory Ramirez', 'Girls Game LA', [0, 0, 2, 0, 2]],
  ['femenil', 'Elea Mota', 'Girls Game LA', [0, 1, 1, 1, 3]],
  ['femenil', 'Jessica Oxlaj', 'Girls Game LA', [0, 0, 1]],
  ['femenil', 'Jessica Camarena', 'Girls Game LA', [0, 0, 0, 0, 1]],
  ['femenil', 'Heidy Argueta', 'Lady Angels', [1]],
  ['femenil', 'Samantha Salguero', 'Lady Angels', [0, 0, 0, 1]],
  ['femenil', 'DEFAULT/AUTOGOAL', 'Lady Angels', [0, 0, 0, 0, 0, 0, 3], true],
  ['femenil', 'Yanei Cruz Rodriguez', 'Las Damas de LC', [0, 0, 1]],
  ['femenil', 'Lizeth Dayanna Gaitan', 'Las Damas de LC', [0, 1, 3, 0, 1, 1]],
  ['femenil', 'Lilia Siles', 'Las Damas de LC', [0, 0, 2, 0, 0, 1]],
  ['femenil', 'Julie Carrillo', 'Las Damas de LC', [0, 0, 4]],
  ['femenil', 'Citlaly Rios', 'Las Damas de LC', []],
  ['femenil', 'Yessica Carranza', 'Las Damas de LC', [0, 0, 0, 0, 0, 1]],
  ['femenil', 'Lihia Lugo', 'Las Damas de LC', [0, 0, 0, 0, 0, 0, 1]],
  ['femenil', 'Yesenia Martinez', 'LAFC7', [2, 1]],
  ['femenil', 'Bricia Lara', 'LAFC7', [0, 1]],
  ['femenil', 'Brenda Martinez', 'LAFC7', [0, 2, 0, 0, 0, 0, 1]],
  ['femenil', 'Claudia Llontop', 'LAFC7', [0, 2]],
  ['femenil', 'Leticia Mat', 'LAFC7', []],
  ['femenil', 'Michelle Juarez', 'LAFC7', [0, 0, 0, 0, 0, 1]],
  ['femenil', 'Ana Jimenez', 'Unamitas FC', [6]],
  ['femenil', 'Analee', 'Unamitas FC', [3]],
  ['femenil', 'Veronica Castro', 'Unamitas FC', [2]],
  ['femenil', 'Marutza Herrera', 'Unamitas FC', [1]],
  ['femenil', 'Ana Cristina Perez', 'Unamitas FC', [0, 0, 0, 1]],
  ['40', 'Ovanel Villalba', 'Atlante', [3, 2, 5, 1, 3, 3, 2, 3, 3]],
  ['40', 'Miguel Sandoval', 'Atlante', [2, 0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Sergio Sontay', 'Atlante', [1, 0, 0, 0, 0, 0, 1]],
  ['40', 'Julio Lopez', 'Atlante', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Edwin Rosales', 'Atlante', [0, 0, 0, 0, 0, 0, 0, 2]],
  ['40', 'DEFAULT/AUTOGOAL', 'Atlante', [0, 0, 0, 0, 0, 0, 0, 0, 1], true],
  ['40', 'Jose Bautista', 'Barcelona', [1, 0, 0, 0, 0, 2]],
  ['40', 'Mario', 'Barcelona', [1]],
  ['40', 'Marco Cruz', 'Barcelona', [0, 1]],
  ['40', 'Jose Luis Sarabia', 'Barcelona', [0, 0, 1, 1, 2]],
  ['40', 'Leswin Posadas', 'Barcelona', [0, 0, 1]],
  ['40', 'Luis Santos', 'Barcelona', [0, 0, 0, 1]],
  ['40', 'Victor', 'Barcelona', [0, 0, 0, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'Barcelona', [0, 0, 0, 0, 1, 0, 0, 1], true],
  ['40', 'Erick Magana', 'Bufalos', [2, 0, 0, 0, 0, 0, 1, 0, 1]],
  ['40', 'Orlando Juarez', 'Bufalos', [1, 0, 0, 1, 0, 1, 0, 2]],
  ['40', 'Francisco Rojas', 'Bufalos', [1, 0, 1, 0, 0, 0, 0, 1, 1]],
  ['40', 'Jose Orozco', 'Bufalos', [1, 0, 0, 1]],
  ['40', 'Ernesto Rojas', 'Bufalos', [0, 1]],
  ['40', 'Rolando Ramos', 'Bufalos', [0, 0, 0, 2, 0, 0, 1]],
  ['40', 'Fabian Vega', 'Bufalos', [0, 0, 0, 1, 0, 0, 1, 1]],
  ['40', 'Guillermo Aguilar', 'Bufalos', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Alejandro Estrada', 'C.D. Ajax', [0, 0, 0, 0, 0, 1]],
  ['40', 'Jose Melgar', 'C.D. Ajax', [0, 0, 0, 1]],
  ['40', 'Byron Morales', 'C.D. Ajax', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'C.D. Ajax', [0, 0, 0, 0, 2, 0, 1], true],
  ['40', 'Miguel Leon', 'Colima FC', [2, 1, 1, 3, 1, 0, 2, 0, 2]],
  ['40', 'David Hernandez', 'Colima FC', [2, 1, 0, 0, 2, 0, 1]],
  ['40', 'Edwin Rodriguez', 'Colima FC', [1, 0, 1, 0, 1]],
  ['40', 'Neftali Rivas', 'Colima FC', [0, 1, 1]],
  ['40', 'Cristian Abarca', 'Colima FC', [0, 1, 0, 0, 0, 0, 2]],
  ['40', 'Jorge Ramos', 'Dep Miramar', [0, 0, 1, 0, 0, 3]],
  ['40', 'Edgar Mariscal', 'Dep Miramar', [2, 0, 0, 1, 0, 0, 0, 1]],
  ['40', 'Leo Gutierrez', 'Dep Miramar', [1]],
  ['40', 'Martin Flores', 'Dep Miramar', [3, 2, 0, 2]],
  ['40', 'Valentin Vargas', 'Dep Miramar', [0, 1, 0, 1, 1, 1, 0, 1]],
  ['40', 'Saul Melchor', 'Dep Miramar', [0, 0, 0, 1, 0, 0, 0, 2, 2]],
  ['40', 'Felix Melendez', 'Dep Miramar', [0, 0, 0, 0, 0, 2]],
  ['40', 'Alex Escobar', 'Dep Miramar', [0, 0, 0, 0, 0, 1]],
  ['40', 'Cesar Vargas', 'Dep Miramar', [0, 0, 0, 0, 0, 0, 0, 2]],
  ['40', 'Rigo Garcia', 'Francisquense FC', [3, 0, 1, 0, 0, 1, 0, 1, 1]],
  ['40', 'Joel Duarte', 'Francisquense FC', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Julio Vicente', 'Francisquense FC', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Raul Torrez', 'Francisquense FC', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'Francisquense FC', [0, 0, 0, 3], true],
  ['40', 'Sergio Orellona', 'Ixtac', [1, 0, 0, 0, 1, 1]],
  ['40', 'Efrain Torrez', 'Ixtac', [1, 1, 0, 0, 0, 0, 1]],
  ['40', 'Jose Valderreme', 'Ixtac', [0, 1, 1]],
  ['40', 'Martin Orosco', 'Ixtac', [0, 0, 0, 0, 8]],
  ['40', 'Nelson Manzanares', 'Ixtac', [0, 0, 0, 0, 1, 1, 2]],
  ['40', 'Daniel Diaz', 'Ixtac', [0, 0, 0, 0, 1]],
  ['40', 'Alfonso Dancif', 'Ixtac', [0, 0, 0, 0, 2]],
  ['40', 'Victor Amador', 'Ixtac', [0, 0, 0, 0, 1, 1, 1, 1]],
  ['40', 'Carlos Rosario', 'Ixtac', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Carmelo', 'Ixtac', [0, 0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Jose Torrez', 'LA City', [2, 0, 1]],
  ['40', 'Nery Escobar', 'LA City', [1]],
  ['40', 'Ayran Ramirez', 'LA City', [0, 0, 0, 0, 0, 2]],
  ['40', 'Byron Sontay', 'LA City', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Angel Chimino', 'LA City', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'Napoleon Panameno', 'LA City', [0, 0, 0, 0, 0, 0, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'LA City', [0, 3, 0, 1, 1], true],
  ['40', 'Mauricio Pena', 'Manchester United', [2, 1, 3, 1, 0, 1, 0, 0, 2]],
  ['40', 'Fidel Garcia', 'Manchester United', [1]],
  ['40', 'Cesar Argueta', 'Manchester United', [0, 1, 1, 2, 0, 3, 2, 1, 6]],
  ['40', 'Ignacio Govea', 'Monarcas', [1]],
  ['40', 'Joaquin Cervantes', 'Monarcas', [1, 1, 0, 0, 0, 0, 1]],
  ['40', 'Juan Perez', 'Monarcas', [0, 2]],
  ['40', 'Juan Gutierrez', 'Monarcas', [0, 0, 1, 0, 0, 1]],
  ['40', 'Luis Prado', 'Monarcas', [0, 0, 0, 0, 1, 1]],
  ['40', 'Gerardo Sierra', 'Monarcas', [0, 0, 0, 0, 1]],
  ['40', 'Juan Cervantez', 'Monarcas', [0, 0, 0, 0, 0, 0, 1, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'Monarcas', [0, 0, 0, 2], true],
  ['40', 'Elmer Perez', 'Nazareno FC', [2, 2, 2, 0, 0, 2, 2]],
  ['40', 'Elvis Escobar', 'Nazareno FC', [1, 0, 0, 0, 0, 0, 2]],
  ['40', 'Carlos De Leon', 'Nazareno FC', [1, 0, 0, 2, 0, 0, 0, 1]],
  ['40', 'Guillermo De Leon', 'Nazareno FC', [1, 0, 0, 0, 0, 1]],
  ['40', 'Minor Cruz', 'Nazareno FC', [0, 0, 0, 1, 0, 0, 1]],
  ['40', 'Pablo Cano', 'Nazareno FC', [0, 0, 0, 2]],
  ['40', 'Rony Urrutia', 'Nazareno FC', [1]],
  ['40', 'David Velazquez', 'Nazareno FC', [0, 0, 0, 1]],
  ['40', 'Ervin Perez', 'Nazareno FC', [0, 0, 0, 1]],
  ['40', 'Flavio Ruano', 'Nazareno FC', [0, 0, 0, 1]],
  ['40', 'Minor Alvarez', 'Nazareno FC', [0, 0, 0, 0, 1]],
  ['40', 'Fredy Quevedo', 'Nazareno FC', [0, 0, 0, 0, 0, 1]],
  ['40', 'Leo', 'Nazareno FC', [0, 0, 0, 0, 0, 1]],
  ['40', 'Sandy Urrutia', 'Nazareno FC', [0, 0, 0, 0, 0, 0, 1, 2]],
  ['40', 'Victor Alvarado', 'Rebano Tuzo', [1, 0, 0, 2, 1, 1, 5, 0, 1]],
  ['40', 'David Hernadez', 'Rebano Tuzo', [0, 1, 2, 1, 0, 1, 3, 2]],
  ['40', 'Salomon Moreno', 'Rebano Tuzo', [1, 0, 1, 0, 1, 1, 0, 0, 1]],
  ['40', 'Oscar Luna', 'Rebano Tuzo', [1, 1, 0, 0, 1, 0, 0, 0, 2]],
  ['40', 'Oliver Camas', 'Rebano Tuzo', [0, 0, 1]],
  ['40', 'Roberto Flores', 'Rebano Tuzo', [0, 0, 0, 0, 1]],
  ['40', 'DEFAULT/AUTOGOAL', 'Unamitas FC', [4], true],
  ['40', 'Erasmo Cid', 'Wolfs FC', [0, 1, 0, 0, 0, 0, 1]],
  ['40', 'Ceslso Pineda', 'Wolfs FC', [0, 1]],
  ['40', 'Daniel Vazquez', 'Wolfs FC', [0, 1, 2, 1, 0, 0, 1]],
  ['40', 'Marlon Bolanos', 'Wolfs FC', [0, 0, 0, 0, 0, 1]],
  ['40', 'Jayro Flores', 'Wolfs FC', [0, 0, 0, 0, 0, 0, 2]],
  ['40', 'DEFAULT/AUTOGOAL', 'Wolfs FC', [0, 0, 0, 0, 0, 1, 2], true],
  ['u19', 'Martin Quintero', 'Atletico FC', [1]],
  ['u19', 'Nicolas Uribe', 'Atletico FC', [1, 1]],
  ['u19', 'Luis Velazquez', 'Atletico FC', [1]],
  ['u19', 'Jeremy Garcia', 'Atletico FC', [0, 1]],
  ['u19', 'Leandro Barrales', 'Atletico Morelia', [0, 1]],
  ['u19', 'Carlos Cruz', 'Humildes FC', [2]],
  ['u19', 'Kemari Elliot', 'Humildes FC', [3]],
  ['u19', 'Adolfo Perez', 'LA City', [1]],
  ['u19', 'Nathan Miranda', 'Cracks FC', [1]],
  ['u19', 'Jeffry Molina', 'Cracks FC', [1, 2]],
  ['u19', 'Jamil Martinez', 'Cracks FC', [1]],
  ['u19', 'Alesandro Rubio', 'Universitario Nacional', [0, 1]],
  ['u19', 'Miguel Fuentes', 'Universitario Nacional', [0, 1]],
  ['u17', 'Damian Amicha', 'Atletico Morelia', [0, 2]],
  ['u17', 'Yair Maya', 'Atletico Morelia', [0, 1]],
  ['u17', 'DEFAULT/AUTOGOAL', 'Atletico Morelia', [3], true],
  ['u17', 'Manuel Marinez', 'Barcelona', [2]],
  ['u17', 'Edgar Soto', 'Barcelona', [0, 1]],
  ['u17', 'Massi', 'Barcelona', [0, 1]],
  ['u17', 'Brandon Leal', 'Barcelona', [0, 1]],
  ['u17', 'Jonathan Reyes', 'Fieras LA FC', [0, 1]],
  ['u17', 'Erasno Cid', 'LA City', [0, 1]],
  ['u17', 'Roberto Carlos', 'LA Juve', [1]],
  ['u17', 'Jason Valencia', 'LA Juve', [1, 2]],
  ['u17', 'Hector Penate', 'FC Portugal', [3, 1]],
  ['u17', 'Luis Calzada', 'Real Azul FC', [0, 1]],
  ['u17', 'Andrew Herrera', 'Santos FC', [2]],
  ['u17', 'Emanuel Herrera', 'Santos FC', [0, 1]],
  ['u17', 'Rojer Lopez', 'Santos FC', [0, 1]],
  ['u17', 'Alex Hernandez', 'Universitario Nacional', [0, 1]],
  ['u15', 'Kevin Gonzalez', 'Aguilitas A', [2]],
  ['u15', 'Matthew Gonzalez', 'Aguilitas A', [1]],
  ['u15', 'Luis Valenzuela', 'Aguilitas B', [1]],
  ['u15', 'Mark Avila', 'Aguilitas B', [0, 1]],
  ['u15', 'Derian Ruiz', 'Alhambra FC', [1]],
  ['u15', 'Luis Ayala', 'Alhambra FC', [1]],
  ['u15', 'Jayden Aguilar', 'Alhambra FC', [0, 1]],
  ['u15', 'Jesus Munos', 'Angelinos FC', [0, 2]],
  ['u15', 'Alexander Ochoa', 'FC Boyle Heights', [1, 1]],
  ['u15', 'Francisco Lopez', 'FC Boyle Heights', [0, 1]],
  ['u15', 'Javier Valdez', 'FC Boyle Heights', [0, 1]],
  ['u15', 'Jesus Medina', 'FC Boyle Heights', [0, 2]],
  ['u15', 'Julio Garcia', 'EMC FC', [1]],
  ['u15', 'Yannick', 'EMC FC', [0, 1]],
  ['u15', 'Jeffry Oxlaj', 'Fieras LA FC', [1]],
  ['u15', 'Santos Resson', 'Fieras LA FC', [1]],
  ['u15', 'Jonathan Reyes', 'Fieras LA FC', [0, 1]],
  ['u15', 'Steven Nava', 'Fieras LA FC', [0, 1]],
  ['u15', 'Isaian Fox', 'Fieras LA FC', [0, 1]],
  ['u15', 'Jesus Ruiz', 'Flamenco FC', [1]],
  ['u15', 'Daniel Gomez', 'Flamenco FC', [1]],
  ['u15', 'Erick Navarro', 'Flamenco FC', [0, 1]],
  ['u15', 'Jonathan Cortez', 'Flamenco FC', [0, 1]],
  ['u15', 'Angel Rivera', 'Invictus FC', [1]],
  ['u15', 'Isaiha Valdovinos', 'Invictus FC', [1]],
  ['u15', 'Ayden Chaires', 'Invictus FC', [2]],
  ['u15', 'Ethan', 'LA Esperanza', [2]],
  ['u15', 'Allan', 'LA Esperanza', [1]],
  ['u15', 'Michael', 'LA Esperanza', [1]],
  ['u15', 'Frank Pino', 'LA Esperanza', [0, 1]],
  ['u15', 'Kyle Garcia', 'LA Esperanza', [0, 1]],
  ['u15', 'Lucas Dayson', 'LA Esperanza', [0, 1]],
  ['u15', 'Xec Allan', 'LA Esperanza', [0, 1]],
  ['u15', 'Alexis Sierra', 'LA Juniors', [3, 2]],
  ['u15', 'Bryan Juarez', 'LA Juniors', [1, 1]],
  ['u15', 'Dave Valladares', 'LA Juniors', [2]],
  ['u15', 'Sebastian Banuelos', 'LA Juniors', [2]],
  ['u15', 'William Morazan', 'LA Juniors', [0, 1]],
  ['u15', 'Angel', 'Legacy XI', [0, 2]],
  ['u15', 'Masiha', 'Pumas Academy', [1]],
  ['u15', 'Ethan Guerra', 'Pumas Academy', [0, 2]],
  ['u15', 'Bryan Sanchez', 'Pumas Academy', [0, 1]],
  ['u15', 'Gustavo Paniagua', 'Pumas Academy', [0, 2]],
  ['u15', 'Julian Armas', 'Pumas Academy', [0, 2]],
  ['u15', 'Eugenio Solis', 'Santa Cruz Thunder', [1]],
  ['u15', 'Gustavo Morales', 'Santa Cruz Thunder', [0, 1]],
  ['u15', 'Eugenio Solis', 'Santa Cruz Thunder', [0, 1]],
  ['u15', 'Gael Casas', 'Unamitas FC', [0, 1]],
  ['u15', 'Adrian Contreras', 'Unamitas FC', [0, 1]],
  ['u15', 'Jonathan', 'Unamitas FC', [0, 1]],
  ['u15', 'Manuel Gonzales', 'Wolfs FC', [1]],
  ['u15', 'Danny Cid', 'Wolfs FC', [2, 1]],
  ['u15', 'Humberto Trujillo', 'Wolfs FC', [2]],
  ['u15', 'Antonio Honorata', 'Wolfs FC', [2]],
  ['u15', 'Gael Gonzalez', 'Wolfs FC', [1]],
  ['u15', 'Erasno', 'Wolfs FC', [1]],
  ['u15', 'Anthony Magallan', 'Wolfs FC', [0, 1]],
  ['u13', 'Matthew Albedano', 'Aguilitas', [1]],
  ['u13', 'Luis Valenzuela', 'Aguilitas', [0, 1]],
  ['u13', 'Gael Salcedo', 'Alhambra FC', [4, 1]],
  ['u13', 'Alan Pina', 'Alhambra FC', [0, 1]],
  ['u13', 'Olwer Zerwanca', 'Angelinos FC', [0, 1]],
  ['u13', 'Julian Ramirez', 'Barcelona', [2]],
  ['u13', 'Cristian Suarez', 'Barcelona', [1]],
  ['u13', 'Luis Monte De Oca', 'Barcelona', [1]],
  ['u13', 'Carlos Asencio', 'Barcelona', [1]],
  ['u13', 'Carlos Juarez', 'Barcelona', [1]],
  ['u13', 'Alex Pena', 'Barcelona', [0, 1]],
  ['u13', 'Daniel Vaquera', 'Barcelona', [0, 4]],
  ['u13', 'Carlos Juarez', 'Barcelona', [0, 1]],
  ['u13', 'Aiden Cerda', 'Escuela River', [4]],
  ['u13', 'Liam Reynoso', 'Escuela River', [3]],
  ['u13', 'Adrian Acevedo', 'Fenix LA', [1]],
  ['u13', 'Gabriel Torrez', 'Fenix LA', [0, 1]],
  ['u13', 'Angel Vargas', 'Fenix LA', [0, 1]],
  ['u13', 'Ivan Mejia', 'Flamenco FC', [10, 5]],
  ['u13', 'Thiago Lemus', 'Flamenco FC', [4]],
  ['u13', 'Matthew Ruiz', 'Flamenco FC', [2]],
  ['u13', 'Jude Goyou', 'Flamenco FC', [2]],
  ['u13', 'Erick Mejia', 'Flamenco FC', [1, 2]],
  ['u13', 'Skiler Morejon', 'Flamenco FC', [1]],
  ['u13', 'Nathan Esparza', 'Flamenco FC', [0, 1]],
  ['u13', 'Matthew Valle', 'Flamenco FC', [0, 2]],
  ['u13', 'Kevin Cuellar', 'LA Esperanza', [4]],
  ['u13', 'Alan Mora', 'LA Esperanza', [2]],
  ['u13', 'Calixto Chavez', 'LA Esperanza', [2, 1]],
  ['u13', 'Issac Barrios', 'LA Esperanza', [1]],
  ['u13', 'Oscar Vargas', 'LA Esperanza', [1]],
  ['u13', 'Jonathan Escobar', 'LA Esperanza', [0, 1]],
  ['u13', 'Liam', 'LA Juve', [2]],
  ['u13', 'Adniel Ramon', 'LA Juve', [2]],
  ['u13', 'Dylan Valencia', 'LA Juve', [2]],
  ['u13', 'Neymar Boshe', 'LA Juve', [4]],
  ['u13', 'Daniel Beshau', 'LA Juve', [1]],
  ['u13', 'Milan Ruiz', 'LA Masia', [2]],
  ['u13', 'Anthony Zamudio', 'LA Masia', [1]],
  ['u13', 'Carlos Hernandez', 'LA Masia', [1]],
  ['u13', 'Roman Garcia', 'LA Masia', [1]],
  ['u13', 'James', 'LA Masia', [1]],
  ['u13', 'Cai', 'LA Masia', [1]],
  ['u13', 'Josepht Silva', 'Los Selectos FC', [0, 2]],
  ['u13', 'Alan Larita', 'Pumas Academy', [1]],
  ['u13', 'Joel Temes', 'Pumas Academy', [1]],
  ['u13', 'Ian Venavides', 'Pumas Academy', [0, 2]],
  ['u13', 'Diego Mayen', 'Pumas Academy', [0, 4]],
  ['u13', 'Michelle Ibanesz', 'Pumas Academy', [0, 1]],
  ['u13', 'Jacob Zhang', 'Titans United FC', [1]],
  ['u13', 'Damian Froilan', 'Unamitas FC', [2]],
  ['u13', 'Axel Bedolla', 'Unamitas FC', [2]],
  ['u13', 'Mauro Garcia', 'Unamitas FC', [1, 1]],
  ['u13', 'Isabella Vazquez', 'Unamitas FC', [0, 1]],
  ['u13', 'Damian Leon', 'Unamitas FC', [0, 1]],
  ['u13', 'Omar Oliva', 'Union FC', [1, 4]],
  ['u13', 'Adam Hernandez', 'Union FC', [1, 3]],
  ['u13', 'Mateo Franco', 'Union FC', [0, 1]],
  ['u13', 'Manuel Gonzalez', 'Wolfs FC', [4, 1]],
  ['u13', 'Steven Xiloj', 'Wolfs FC', [1, 1]],
  ['u13', 'Adrian Martinez', 'Wolfs FC', [1]],
  ['u13', 'Nathan Matamoros', 'Wolfs FC', [0, 1]],
  ['u11', 'Mateo Menendez', 'Alhambra FC', [1]],
  ['u11', 'James Torrez', 'Alhambra FC', [1, 2]],
  ['u11', 'Aaron Nichols', 'Alhambra FC', [1, 1]],
  ['u11', 'Diego Escobar', 'Alhambra FC', [1]],
  ['u11', 'Noah Rizo', 'Alhambra FC', [2]],
  ['u11', 'Jaxson Gonzalez', 'Alhambra FC', [1, 1]],
  ['u11', 'Jordhan Larios', 'Alhambra FC', [1, 1]],
  ['u11', 'Liev Kaplan', 'Alhambra FC', [1, 1]],
  ['u11', 'Sebastian Salcedo', 'Alhambra FC', [0, 1]],
  ['u11', 'Iker Valencia', 'Alhambra FC', [0, 1]],
  ['u11', 'Damian Moreno', 'Barcelona', [5, 3]],
  ['u11', 'Leonel Sanchez', 'Barcelona', [4, 2]],
  ['u11', 'Benny Cebreros', 'Barcelona', [3, 1]],
  ['u11', 'Darien Diaz', 'Barcelona', [1]],
  ['u11', 'Adrian Garcia', 'Barcelona', [1]],
  ['u11', 'Victor Vaquera', 'Barcelona', [1]],
  ['u11', 'Dylan Sarabia', 'Barcelona', [1]],
  ['u11', 'Dylan Cubias', 'Barcelona', [0, 2]],
  ['u11', 'Leo Santa Cruz', 'Barcelona', [0, 1]],
  ['u11', 'Paul Perez', 'Fenix LA', [2, 2]],
  ['u11', 'Jared Mercado', 'Fenix LA', [3]],
  ['u11', 'Kennet Alvarado', 'Fenix LA', [1]],
  ['u11', 'Ayalisse', 'Fenix LA', [0, 1]],
  ['u11', 'Andy Garcia', 'Fieras LA FC', [3, 4]],
  ['u11', 'Dylan Terraza', 'Fieras LA FC', [3]],
  ['u11', 'Donaldo Vazquez', 'Fieras LA FC', [3]],
  ['u11', 'Alex Perez', 'Fieras LA FC', [1]],
  ['u11', 'Liam Gonzalez', 'Fieras LA FC', [0, 1]],
  ['u11', 'Irvin', 'Inter Milan', [1]],
  ['u11', 'Benjamin Meneses', 'Jrs FC', [3]],
  ['u11', 'Luis Fermin', 'Jrs FC', [1]],
  ['u11', 'William Solorio', 'Jrs FC', [0, 1]],
  ['u11', 'Abel Abyad', 'LA Juve', [1]],
  ['u11', 'Favian Garcia', 'Los Selectos FC', [7, 1]],
  ['u11', 'Romeo Rojas', 'Los Selectos FC', [9, 2]],
  ['u11', 'Anthony Jaurigui', 'Los Selectos FC', [2, 2]],
  ['u11', 'Jaxan Hendrix', 'Los Selectos FC', [4]],
  ['u11', 'Ayden Quitiquit', 'Los Selectos FC', [2]],
  ['u11', 'Ezequiel Valencia', 'Los Selectos FC', [1]],
  ['u11', 'Valentina', 'Los Selectos FC', [1]],
  ['u11', 'Dylan Oxlaj', 'Los Selectos FC', [2]],
  ['u11', 'Nathanel Rodriguez', 'Los Selectos FC', [2]],
  ['u11', 'Evan Gudino', 'South Central United FC', [1]],
  ['u11', 'Adrian Urrutia', 'South Central United FC', [1]],
  ['u11', 'Mason Esparsa', 'South Central United FC', [2]],
  ['u11', 'Ezio Passareli', 'South Central United FC', [3]],
  ['u11', 'Matthew Galindo', 'South Central United FC', [2]],
  ['u11', 'Julian Alcaras', 'Titans United FC', [3, 1]],
  ['u11', 'Andres Hernandez', 'Titans United FC', [4]],
  ['u11', 'Leandro Medina', 'Titans United FC', [1, 11]],
  ['u11', 'David Marquez', 'Titans United FC', [0, 1]],
  ['u11', 'Alfonso Hernandez', 'Titans United FC', [0, 1]],
  ['u11', 'Sebastian Villatoro', 'Titans United FC', [0, 3]],
  ['u11', 'Dylan Flores', 'Wolfs FC', [0, 2]],
  ['u11', 'Gaspar Crespo', 'Wolfs FC', [0, 4]],
  ['u11', 'Gustavo Romano', 'Wolfs FC', [0, 5]],
  ['u11', 'Leilany Velez', 'Wolfs FC', [0, 2]],
  ['u11', 'Axel Romero', 'Wolfs FC', [0, 4]],
  ['u9', 'Avery Orosco', 'Alhambra FC', [2]],
  ['u9', 'Mateo Catsares', 'Alhambra FC', [1]],
  ['u9', 'Jason Guachiac', 'Alhambra FC', [1, 2]],
  ['u9', 'Abraham Ravelo', 'Alhambra United', [4, 2]],
  ['u9', 'Anel Sierra', 'Alhambra United', [4]],
  ['u9', 'Brandon Carmona', 'Alhambra United', [3, 2]],
  ['u9', 'Matthew Argueta', 'Alhambra United', [3, 4]],
  ['u9', 'Mateo Enriquez', 'Alhambra United', [1]],
  ['u9', 'Diego Barrientos', 'Alhambra United', [0, 1]],
  ['u9', 'Jonas Estrada', 'Alhambra United', [0, 2]],
  ['u9', 'Audia Juarez', 'Fieras LA FC', [1]],
  ['u9', 'Tiago', 'Fieras LA FC', [0, 2]],
  ['u9', 'Ailyn', 'Fieras LA FC', [0, 1]],
  ['u9', 'Aby', 'Fieras LA FC', [0, 1]],
  ['u9', 'Yael Chilel', 'LA Esperanza', [6, 3]],
  ['u9', 'Matty Coronado', 'LA Esperanza', [4]],
  ['u9', 'Issac Lucas', 'LA Esperanza', [4, 1]],
  ['u9', 'Genaro', 'LA Esperanza', [2]],
  ['u9', 'Elbin De Paz', 'LA Esperanza', [5]],
  ['u9', 'Jose', 'LA Esperanza', [0, 1]],
  ['u9', 'Jayden', 'LA Esperanza', [0, 2]],
  ['u9', 'Mateo', 'LA Esperanza', [0, 1]],
  ['u9', 'Edson Lazaro', 'Los Selectos FC', [0, 1]],
  ['u9', 'Diego Campos', 'Los Selectos FC', [0, 2]],
  ['u9', 'Sebastian Cano', 'Los Selectos FC', [0, 1]],
  ['u9', 'Gianni Martinez', 'Los Selectos FC', [0, 2]],
  ['u9', 'Santiago Alvizar', 'South Central United FC', [1]],
  ['u9', 'Renato Ceballos', 'South Central United FC', [1, 1]],
  ['u9', 'Iker Ramirez', 'South Central United FC', [1]],
  ['u9', 'Marcos Rojas', 'South Central United FC', [2, 1]],
  ['u9', 'Liam Corrales', 'South Central United FC', [0, 1]],
  ['u9', 'Camila Barbosa', 'South Central United FC', [0, 2]],
  ['u9', 'Tadeo', 'Unamitas Elite', [3, 1]],
  ['u9', 'Joshua', 'Unamitas Elite', [1]],
  ['u7', 'Erik Yael Sanchez', 'Alhambra United', [1]],
  ['u7', 'Asher', 'Fieras LA FC', [0, 1]],
  ['u7', 'Angelick', 'Fieras LA FC', [0, 1]],
  ['u7', 'Luka Serrano', 'Force FC', [2, 1]],
  ['u7', 'Abel Bautista', 'Force FC', [1, 1]],
  ['u7', 'Felipe Navarro', 'Force FC', [1]],
  ['u7', 'Itzel Vega', 'Force FC', [1]],
  ['u7', 'Alonso', 'Leon FC', [0, 1]],
  ['u7', 'Arlo Barrientos', 'Los Selectos FC', [3]],
  ['u7', 'Liam Echeverria', 'Los Selectos FC', [2]],
  ['u7', 'Martin Ramos', 'Los Selectos FC', [1, 1]],
  ['u7', 'Nelly Ge', 'Unamitas FC', [2]],
  ['u7', 'Justin', 'Unamitas FC', [1]],
  ['u7', 'Liam', 'Unamitas FC', [1]],
  ['u7', 'Jeremy', 'Unamitas FC', [0, 1]],
  ['u5', 'Mattias Aresola', 'Alhambra United', [3]],
  ['u5', 'DEFAULT/AUTOGOAL', 'Alhambra United', [0, 3], true],
  ['u5', 'Martin Ramos', 'Los Selectos FC', [2, 1]],
  ['u5', 'Justin', 'Unamitas FC', [2]],
  ['u5', 'Derek', 'Unamitas FC', [1]],
];

// The league calls Bitely's little-kids field "Field 0"; the old site lists it as Field 4.
const fieldName = place => place.trim().replace(' - ', ' – ').replace('#', '').replace('Bitely ES – Field 4', 'Bitely ES – Field 0');
const fieldId = place => fieldName(place).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Strip the division tag the old site adds to team names ("Barcelona U-11", "Invictus FC U15").
function teamName(raw) {
  let name = raw.trim().replace(/\s+/g, ' ');
  while (/\sU-?\d+[A-Z]?$/.test(name)) name = name.replace(/\sU-?\d+[A-Z]?$/, '');
  return name;
}

// Futsal has its own two side-by-side fields, labeled 1 and 2 (the old site filed them under El Sereno Park).
const futsalField = place => place.replace(/^.*Field\s*#?(\d+)$/, 'Futsal – Field $1');

function parseResults(text, div) {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const [date, slot, rawPlace, home, away, score] = line.split('|');
    const futsal = DIVISIONS.some(d => d.id === div && d.group === 'futsal');
    const place = futsal ? futsalField(rawPlace.trim()) : rawPlace;
    const [mm, dd, yyyy] = date.split('/');
    const [hs, as] = score.split('-').map(n => parseInt(n, 10));
    return {
      date: `${yyyy}-${mm}-${dd}`,
      time: slot.split(' - ')[0].replace(/(AM|PM)$/, ' $1'),
      field: fieldId(place), place: fieldName(place),
      home: teamName(home), away: teamName(away), hs, as,
    };
  });
}

const FIELDS = Object.fromEntries(
  Object.entries(RESULTS).flatMap(([div, text]) => parseResults(text, div)).map(m => [m.field, m.place])
    .sort((a, b) => a[1].localeCompare(b[1])),
);

// --- date and time helpers ---

function toMin(time) {
  const [, h, m, ap] = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  return ((+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0)) * 60 + +m;
}

function fromMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedData() {
  let id = 1;
  const teams = Object.fromEntries(DIVISIONS.map(d => [d.id, []]));
  const matches = [];
  Object.entries(RESULTS).forEach(([div, text]) => {
    parseResults(text, div).forEach(({ place, ...m }) => {
      matches.push({ id: id++, div, ...m, goals: [] });
      [m.home, m.away].forEach(name => teams[div].includes(name) || teams[div].push(name));
    });
  });
  const scorers = SEED_SCORERS.map(([div, name, team, games = [], own = false], i) =>
    ({ id: i + 1, div, name, team, games: [...games], goals: games.reduce((n, g) => n + g, 0), own }));
  const seasons = Object.fromEntries(DIVISIONS.map(d => [d.id, defaultSeason(d.id)]));
  return { teams, matches, scorers, seasons, archive: [], nextId: id, nextScorerId: scorers.length + 1 };
}
