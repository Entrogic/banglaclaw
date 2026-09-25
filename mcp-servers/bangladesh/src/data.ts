export interface District {
  name: string;
  nameBn: string;
}

export interface Division {
  name: string;
  nameBn: string;
  districts: District[];
}

const d = (name: string, nameBn: string): District => ({ name, nameBn });

/** The 8 administrative divisions and 64 districts of Bangladesh. */
export const DIVISIONS: readonly Division[] = [
  {
    name: "Dhaka",
    nameBn: "ঢাকা",
    districts: [
      d("Dhaka", "ঢাকা"), d("Faridpur", "ফরিদপুর"), d("Gazipur", "গাজীপুর"), d("Gopalganj", "গোপালগঞ্জ"),
      d("Kishoreganj", "কিশোরগঞ্জ"), d("Madaripur", "মাদারীপুর"), d("Manikganj", "মানিকগঞ্জ"), d("Munshiganj", "মুন্সীগঞ্জ"),
      d("Narayanganj", "নারায়ণগঞ্জ"), d("Narsingdi", "নরসিংদী"), d("Rajbari", "রাজবাড়ী"), d("Shariatpur", "শরীয়তপুর"),
      d("Tangail", "টাঙ্গাইল"),
    ],
  },
  {
    name: "Chattogram",
    nameBn: "চট্টগ্রাম",
    districts: [
      d("Bandarban", "বান্দরবান"), d("Brahmanbaria", "ব্রাহ্মণবাড়িয়া"), d("Chandpur", "চাঁদপুর"), d("Chattogram", "চট্টগ্রাম"),
      d("Cox's Bazar", "কক্সবাজার"), d("Cumilla", "কুমিল্লা"), d("Feni", "ফেনী"), d("Khagrachhari", "খাগড়াছড়ি"),
      d("Lakshmipur", "লক্ষ্মীপুর"), d("Noakhali", "নোয়াখালী"), d("Rangamati", "রাঙ্গামাটি"),
    ],
  },
  {
    name: "Rajshahi",
    nameBn: "রাজশাহী",
    districts: [
      d("Bogura", "বগুড়া"), d("Chapai Nawabganj", "চাঁপাইনবাবগঞ্জ"), d("Joypurhat", "জয়পুরহাট"), d("Naogaon", "নওগাঁ"),
      d("Natore", "নাটোর"), d("Pabna", "পাবনা"), d("Rajshahi", "রাজশাহী"), d("Sirajganj", "সিরাজগঞ্জ"),
    ],
  },
  {
    name: "Khulna",
    nameBn: "খুলনা",
    districts: [
      d("Bagerhat", "বাগেরহাট"), d("Chuadanga", "চুয়াডাঙ্গা"), d("Jashore", "যশোর"), d("Jhenaidah", "ঝিনাইদহ"),
      d("Khulna", "খুলনা"), d("Kushtia", "কুষ্টিয়া"), d("Magura", "মাগুরা"), d("Meherpur", "মেহেরপুর"),
      d("Narail", "নড়াইল"), d("Satkhira", "সাতক্ষীরা"),
    ],
  },
  {
    name: "Barishal",
    nameBn: "বরিশাল",
    districts: [
      d("Barguna", "বরগুনা"), d("Barishal", "বরিশাল"), d("Bhola", "ভোলা"), d("Jhalokati", "ঝালকাঠি"),
      d("Patuakhali", "পটুয়াখালী"), d("Pirojpur", "পিরোজপুর"),
    ],
  },
  {
    name: "Sylhet",
    nameBn: "সিলেট",
    districts: [d("Habiganj", "হবিগঞ্জ"), d("Moulvibazar", "মৌলভীবাজার"), d("Sunamganj", "সুনামগঞ্জ"), d("Sylhet", "সিলেট")],
  },
  {
    name: "Rangpur",
    nameBn: "রংপুর",
    districts: [
      d("Dinajpur", "দিনাজপুর"), d("Gaibandha", "গাইবান্ধা"), d("Kurigram", "কুড়িগ্রাম"), d("Lalmonirhat", "লালমনিরহাট"),
      d("Nilphamari", "নীলফামারী"), d("Panchagarh", "পঞ্চগড়"), d("Rangpur", "রংপুর"), d("Thakurgaon", "ঠাকুরগাঁও"),
    ],
  },
  {
    name: "Mymensingh",
    nameBn: "ময়মনসিংহ",
    districts: [d("Jamalpur", "জামালপুর"), d("Mymensingh", "ময়মনসিংহ"), d("Netrokona", "নেত্রকোণা"), d("Sherpur", "শেরপুর")],
  },
];

/** Common alternate spellings → current official English names. */
export const ALIASES: Readonly<Record<string, string>> = {
  chittagong: "Chattogram",
  comilla: "Cumilla",
  barisal: "Barishal",
  bogra: "Bogura",
  jessore: "Jashore",
  "coxs bazar": "Cox's Bazar",
  "cox bazar": "Cox's Bazar",
  netrakona: "Netrokona",
  jhalakathi: "Jhalokati",
  "nawabganj": "Chapai Nawabganj",
  maulvibazar: "Moulvibazar",
  laxmipur: "Lakshmipur",
};
