// Jersey titbits for the morning brief: a fixed, checked list (no AI-invented "facts"), one per day in turn.
export const FACTS = [
  "Jersey was occupied by German forces from 1 July 1940 until Liberation Day, 9 May 1945, which is still a public holiday.",
  "In the Battle of Jersey on 6 January 1781, a French force landed at La Rocque and took St Helier, but was beaten in the Royal Square by troops under Major Francis Peirson, who was killed at the moment of victory.",
  "Mont Orgueil Castle at Gorey was begun in the 13th century, after King John lost mainland Normandy in 1204 and Jersey stayed loyal to the English Crown.",
  "Elizabeth Castle was named after Queen Elizabeth I by Sir Walter Raleigh, who was Governor of Jersey from 1600 to 1603.",
  "St Helier is named after Helier, a 6th-century hermit who lived on a rock beside Elizabeth Castle, still known as the Hermitage.",
  "In February 1649, just weeks after Charles I was executed, Jersey proclaimed his son Charles II king while England was becoming a republic.",
  "Sir George Carteret, who sheltered the future Charles II in Jersey, was later given land in America that was named New Jersey after the island.",
  "La Hougue Bie in Grouville is a Neolithic passage grave more than 5,000 years old, with a medieval chapel built on top of its mound.",
  "Jersey has one of the biggest tidal ranges in the world: on big spring tides the sea rises and falls by around 12 metres.",
  "Seymour Tower, built in 1782 on a rock off La Rocque, can be walked to across the seabed at low tide, with a guide.",
  "La Corbière Lighthouse, first lit in 1874, was the first lighthouse in the British Isles built of concrete.",
  "Lillie Langtry, the actress and society beauty nicknamed the Jersey Lily, was born in Jersey in 1853 and is buried at St Saviour's Church.",
  "Victor Hugo lived in exile in Jersey from 1852 until he was expelled in 1855, when he moved on to Guernsey.",
  "Jersey Zoo was founded by the naturalist Gerald Durrell in 1959 at Les Augrès Manor in Trinity, to save endangered species.",
  "To keep the Jersey breed pure, the island banned imports of live cattle from 1789, a rule that lasted more than two centuries.",
  "Jersey Royal potatoes trace back to Hugh de la Haye, who around 1880 planted pieces of an unusually large potato, one of which gave the first kidney-shaped Royals.",
  "Jersey Royals were given Protected Designation of Origin status by the European Union in 1996.",
  "The Battle of Flowers parade was first held in 1902 to celebrate the coronation of King Edward VII; the floats were originally torn apart in a flower fight at the end.",
  "Jersey has twelve parishes, and each one is run by its own elected Connétable.",
  "Jèrriais, the island's own form of Norman French, is still spoken and taught in some Jersey schools.",
  "In 1953 the International Court of Justice ruled that the Écréhous and Minquiers reefs belong to Jersey, not France.",
  "Jersey's highest point is Les Platons in Trinity, about 136 metres above sea level.",
  "Jersey is a Crown Dependency: it belongs to the Crown but has never been part of the United Kingdom.",
  "The knitted jersey takes its name from the island, whose knitting trade made warm woollen garments for fishermen and sailors.",
  "The Jersey War Tunnels were dug by forced labourers during the Occupation and were fitted out as an emergency hospital.",
  "In September 1942, more than a thousand UK-born Jersey residents were deported by the occupying forces to internment camps in Germany.",
  "Jersey was liberated on 9 May 1945 when British forces arrived; HMS Beagle's officers took the island's surrender.",
  "The Liberation sculpture in Liberation Square, St Helier, was unveiled in 1995 to mark fifty years since the end of the Occupation.",
  "St Ouen's Bay stretches for about five miles along Jersey's west coast, which is why the road behind it is called the Five Mile Road.",
  "Jersey cows are famous worldwide for their rich, creamy milk with a high butterfat content.",
  "Jersey's flag, a red saltire on white, gained the royal badge of three lions and a crown in 1981.",
  "Elizabeth Castle can be reached on foot across a causeway at low tide; when the tide is in, an amphibious ferry runs instead.",
  "The painter Sir John Everett Millais came from a Jersey family, and in 1878 he painted Lillie Langtry in 'A Jersey Lily'.",
  "The Jersey round towers along the coast were built in the late 18th century under the Governor, General Henry Seymour Conway, to guard against French invasion.",
  "Jersey gets most of its electricity from France, through undersea cables.",
  "Jersey issues its own banknotes and coins; the Jersey pound is worth the same as sterling.",
  "Jersey people are nicknamed 'crapauds', after the toads found in Jersey but not in Guernsey.",
  "The little Fishermen's Chapel beside St Brelade's Church has rare medieval wall paintings.",
  "The Puritan writer William Prynne was imprisoned in Mont Orgueil Castle from 1637 to 1640, and wrote about the castle while he was there.",
  "Jersey's coat of arms shows three gold lions on red, the same as the royal arms of England.",
  "Gorey's oyster beds made it a boom town in the early 19th century, when hundreds of boats worked the oyster fishery off the east coast.",
  "The Channel Islands are the last remaining part of the old Duchy of Normandy, and islanders still toast the King as 'the Duke of Normandy'.",
];

const dayNumber = (d) => {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
  return Math.floor(Date.parse(ymd + "T00:00:00Z") / 864e5);
};
// The same titbit all day, a different one each day, cycling through the list.
export const factFor = (d = new Date()) => FACTS[dayNumber(d) % FACTS.length];
export const randomFact = () => FACTS[Math.floor(Math.random() * FACTS.length)];
