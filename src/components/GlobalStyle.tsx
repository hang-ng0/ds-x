import {createGlobalStyle} from "styled-components";
import SuperChildishFont from "../assets/super-childish-font/SuperChildish-1jYoL.ttf";


const GlobalStyle = createGlobalStyle`
    *{
        box-sizing: border-box;
        margin: 0;
    }
    @font-face {
        font-family: "TitleFont";
        src: url(${SuperChildishFont}) ;
    }
    
    header h1{
        font: calc(2px + 3vw) "TitleFont", "Comic Sans MS", Papyrus, fantasy;
    }
`;


export default GlobalStyle;