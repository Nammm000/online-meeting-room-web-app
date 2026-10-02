package tech.getarrays.meetingroom.constants;

public class PaymentConstants {
    public static final String partnerMOMOCode = "MOMO";
    public static final String accessMOMOKey = "F8BBA842ECF85";
    public static final String secretMOMOKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    public static final String MOMOendpoint = "https://test-payment.momo.vn/v2/gateway/api/create";
    public static final String ipnUrlMOMO = "http://your-backend/api/payment/momo/ipn";
    public static final String redirectUrlResultMOMO = "http://localhost:4200/payment-result";

    public static final String VNP_PAY_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
    public static final String VNP_RETURN_URL = "http://localhost:8081/api/payment/vnpay-return";
    public static final String VNP_TMN_CODE = "YP73Q3IZ";
    public static final String VNP_SECRET_KEY = "EOBRKB2E7A89YTLXJQH8JEQBMWE7YBRZ";
    public static final String VERSION = "2.1.0";
    public static final String COMMAND = "pay";
    public static final String ORDER_TYPE = "150000";

    public static final int APP_ID = 2554; // 2554
    public static final String KEY1 = "sdngKKJmqEMzvh5QQcdD2A9XBSKUNaYn";
    // sdngKKJmqEMzvh5QQcdD2A9XBSKUNaYn PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL
    public static final String KEY2 = "trMrHtvjo6myautxDUiAcYsVtaeQ8nhf";
    // trMrHtvjo6myautxDUiAcYsVtaeQ8nhf kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz
    public static final String ENDPOINTZALOPAY = "https://sb-openapi.zalopay.vn/v2/create";// REAL: https://openapi.zalopay.vn/v2/create
}
