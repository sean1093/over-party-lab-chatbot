const appendZero = s => s < 10 ? `0${s}` : s;
const timeConvertService = (d) => {
    const year = d.getFullYear();
    const month = appendZero(d.getMonth() + 1);
    const date = appendZero(d.getDate());
    const hour = appendZero(d.getHours());
    const min = appendZero(d.getMinutes());
    const sec = appendZero(d.getSeconds());
    const millsec = appendZero(d.getMilliseconds());
    const YYYY = year.toString();
    const MM = month.toString();
    const DD = date.toString();
    const YYYYMMDD = YYYY + MM + DD;
    const HHMMSS = `${hour.toString()}:${min.toString()}:${sec.toString()}`;
    const HHMMSSS = `${HHMMSS}.${millsec.toString()}`;
    const formatTime = `${YYYY}-${MM}-${DD} ${HHMMSS}`;      
    return formatTime;
};

const timeService = {
    getCurrentTime: () => timeConvertService(new Date()),
    getCurrentYear: () => (new Date()).getFullYear()
}

export default timeService;
  