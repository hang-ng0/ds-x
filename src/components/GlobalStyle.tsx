import {createGlobalStyle} from "styled-components";
import SuperChildishFont from "../assets/super-childish-font/SuperChildish-1jYoL.ttf";
import LilitaOne from "../assets/Lilita_One/LilitaOne-Regular.ttf";


const GlobalStyle = createGlobalStyle`
    *{
        box-sizing: border-box;
        margin: 0;
    }
    @font-face {
        font-family: "SuperChildishFont";
        src: url(${SuperChildishFont}) ;
    }

    @font-face {
        font-family: "LilitaOne";
        src: url(${LilitaOne}) ;
    }
    
    h1{
        font: calc(2px + 4vw) "SuperChildishFont", "Comic Sans MS", Papyrus, fantasy;
    }
    
    nav{
        font: calc(2px + 2vw) "LilitaOne", "Comic Sans MS", Papyrus, fantasy;
    }
`;


export default GlobalStyle;