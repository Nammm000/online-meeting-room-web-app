export class GlobalMessages {
    //Message
    public static genericError: string = "Something went wrong, Please try again later";

    public static unauthorized: string = "You are not authorized person to access this page";

    public static existError: string = "already exists";
    
    public static addedSuccess: string = "added successfully";

}

export class GlobalRegexes {
    //regex

    public static timeStringRegex: RegExp = /(\d+)\s*(year|years|month|months|day|days)/gi;

    public static nameRegex: RegExp = /^[a-zA-Z0-9 ]*$/;
    // public static nameRegex: string = "[a-zA-Z0-9 ]*";

    // public static emailRegex: RegExp = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;
    // public static emailRegex: string = "[A-Za-z0-9._%-]+@[A-Za-z0-9._%-]+\\.[a-z]{2,3}";
    public static emailRegex: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // public static phoneRegex: string = "^[0-9]{10,10}$";
    public static phoneRegex: RegExp = /^[0-9]{10,10}$/;

}

export class GlobalConstants {

    //Variable
    public static error: string = "error";
    public static success: string = "success";
}