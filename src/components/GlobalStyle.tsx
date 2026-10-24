import {createGlobalStyle} from "styled-components";
import SuperChildishFont from "../assets/super-childish-font/SuperChildish-1jYoL.ttf";


const GlobalStyle = createGlobalStyle`
    @font-face {
        font-family: "TitleFont";
        src: url(${SuperChildishFont}) ;
    }
    
    header h1{
        font-family: "SuperChildishFont", "Comic Sans MS", Papyrus, fantasy;
    }
`;


export default GlobalStyle;