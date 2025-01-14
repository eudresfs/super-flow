// utils/dateHelper.js
class DateHelper {
  static getLastSixMonths() {
    const dates = [];
    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth() + 1;

    for (let i = 0; i < 6; i++) {
      month--;
      if (month === 0) {
        month = 12;
        year--;
      }
      dates.push(`${year}${month.toString().padStart(2, '0')}`);
    }
    return dates;
  }
}

module.exports.DateHelper = DateHelper;