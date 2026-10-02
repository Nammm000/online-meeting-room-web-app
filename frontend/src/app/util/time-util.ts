import { GlobalRegexes } from "./../component/shared/global-constants";

// const monthNamesEng = ["January", "February", "March", "April", "May", "June",
//   "July", "August", "September", "October", "November", "December"
// ];

// const dayNamesEng = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthNames = [
  "Tháng 01",
  "Tháng 02",
  "Tháng 03",
  "Tháng 04",
  "Tháng 05",
  "Tháng 06",
  "Tháng 07",
  "Tháng 08",
  "Tháng 09",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

const dayNames = [
  "Chủ nhật",
  "Thứ hai",
  "Thứ ba",
  "Thứ tư",
  "Thứ năm",
  "Thứ sáu",
  "Thứ bảy",
];

export function customFormattedDate(isoString: string) {
  const date = new Date(isoString);

  const datee = date.getDate();
  let dateStr: string;
  if (datee < 10) {
    dateStr = "0" + datee;
  } else {
    dateStr = datee + "";
  }

  const monthIndex = date.getMonth(); // 0-indexed (January is 0)
  const year = date.getFullYear();
  const day = date.getDay();

  const formattedDate = `${dayNames[day]}, ${dateStr} ${monthNames[monthIndex]}, ${year}`;

  return formattedDate; // date.toString()
}

export function msToTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30); // Approximation (30 days/month)

  const remainingDays = days % 30;
  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  return {
    months,
    days: remainingDays,
    hours: remainingHours,
    minutes: remainingMinutes,
    seconds: remainingSeconds,
  };
}

export function formatNumber(num: number) {
  return num.toLocaleString("de-DE");
}

export function timeToDays(time: string): number {
  const units: Record<string, number> = {
    year: 365,
    years: 365,
    month: 30,
    months: 30,
    day: 1,
    days: 1,
  };

  // const regexTimeString = /(\d+)\s*(year|years|month|months|day|days)/gi;

  let totalDays = 0;
  let match: RegExpExecArray | null;

  while ((match = GlobalRegexes.timeStringRegex.exec(time)) !== null) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    totalDays += value * units[unit];
  }

  return totalDays;
}

export function daysToTimeString(days: number): string {
  const YEAR = 365;
  const MONTH = 30;
  const years = Math.floor(days / YEAR);
  const remainingAfterYears = days % YEAR;
  const months = Math.floor(remainingAfterYears / MONTH);
  const remainingDays = remainingAfterYears % MONTH;
  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  }
  if (months > 0) {
    parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  }
  if (remainingDays > 0) {
    parts.push(`${remainingDays} day${remainingDays !== 1 ? "s" : ""}`);
  }
  return parts.length > 0 ? parts.join(" ") : "0 day";
}

export function addDays(date: Date, days: number): string {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + days);

  // Format local date parts — toISOString() would shift back a day in UTC+ timezones
  const year = result.getFullYear();
  const month = String(result.getMonth() + 1).padStart(2, "0");
  const day = String(result.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
